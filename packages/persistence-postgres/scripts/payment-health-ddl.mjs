import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0032" },
  });
  const client = new Client(config);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      await readFile(
        new URL(
          "../../../database/migrations/0033_payment-provider-health.up.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query(
      await readFile(
        new URL(
          "../../../database/migrations/0033_payment-provider-health.down.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query(
      await readFile(
        new URL(
          "../../../database/migrations/0033_payment-provider-health.up.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query("ROLLBACK");
    console.log(
      JSON.stringify({
        outcome: "PASS",
        scope: "0033 empty up/down/up in real PostgreSQL after 0032",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        outcome: "FAIL",
        code: error.code,
        position: error.position,
        message: error.message,
      }),
    );
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}).catch(() => {
  process.exitCode = 1;
});
