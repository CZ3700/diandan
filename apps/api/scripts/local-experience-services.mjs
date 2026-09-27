import { Client, Pool } from "pg";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { startLocalExperienceOidc } from "./local-experience-services-oidc.mjs";
import { startLocalExperiencePsp } from "./local-experience-services-psp.mjs";
import { startLocalExperienceMail } from "./local-experience-services-mail.mjs";
import { localPaymentProfile } from "./local-experience-payment-profile.mjs";

/** Separate durable TEST provider state; stopping closes connections and never drops data. */
export async function startLocalExperienceServices({
  config: input,
  database,
  own,
}) {
  const config = localExperienceConfigSchema.parse(input);
  if (
    !["127.0.0.1", "localhost"].includes(database.host) ||
    database.port !== config.ports.postgres ||
    database.database !== config.database.database
  )
    throw new TypeError("Local services require the owned PostgreSQL cluster");
  const name = config.services.psp.databaseName;
  const admin = new Client(database);
  await admin.connect();
  try {
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [name],
    );
    if (!existing.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const providerDatabase = { ...database, database: name },
    pool = new Pool({ ...providerDatabase, max: 6 });
  const resources = [() => pool.end()];
  let closing;
  const close = () =>
    (closing ??= (async () => {
      const failures = [];
      for (const cleanup of [...resources].reverse())
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      if (failures.length) throw new Error("Local service cleanup failed");
    })());
  try {
    const oidc = await startLocalExperienceOidc({ config });
    resources.push(() => oidc.close());
    const psp = localPaymentProfile(config).startFakePsp
      ? await startLocalExperiencePsp({
          config,
          database: providerDatabase,
          pool,
        })
      : undefined;
    if (psp) resources.push(() => psp.close());
    const mail = await startLocalExperienceMail({ config, pool });
    resources.push(() => mail.close());
    own?.("local TEST identity/payment/mail services", close);
    return { oidc, psp, mail, close };
  } catch (error) {
    await close();
    throw error;
  }
}
