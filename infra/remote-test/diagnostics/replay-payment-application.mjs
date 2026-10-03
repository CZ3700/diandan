// Replay the waiting payment observations once, exactly as the worker's order-payment application
// does, and report only the SQLSTATE, PL/pgSQL function, constraint and a plain message of any
// database failure (the same safe fields the local supervisor records).
// Runs against the scratch copy from copy-database.sh (DIAG_DB, default diag_payments). Replaying on
// the live database performs the worker's own action and requires --live explicitly.
// Usage (as the runtime user): node replay-payment-application.mjs [--limit 3] [--live]
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const app = process.env.APP_ROOT ?? "/home/xiadan/app";
const instance = process.env.INSTANCE ?? "stg";
const args = process.argv.slice(2);
const live = args.includes("--live");
const limit = Number(args[args.indexOf("--limit") + 1] ?? 3) || 3;
const requirePersistence = createRequire(path.join(app, "packages/persistence-postgres/package.json"));
const pg = requirePersistence("pg");
const config = requirePersistence(path.join(app, "node_modules/.cache/fan-support-local-experience", instance, "config.json"));
const database = live ? config.database.database : process.env.DIAG_DB ?? "diag_payments";
if (!live && database === config.database.database) throw new Error("refusing: scratch equals live; pass --live");

const original = pg.Client.prototype.query;
pg.Client.prototype.query = function (...queryArgs) {
  const result = original.apply(this, queryArgs);
  if (!result?.catch) return result;
  return result.catch((error) => {
    const name = (value) => (/^[a-z_][a-z_0-9]{0,127}$/u.test(value ?? "") ? value : null);
    console.log(
      JSON.stringify({
        postgresFailure: {
          code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null,
          guard: name(/PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(error?.where ?? "")?.[1]),
          constraint: name(error?.constraint),
          message: /^[a-z][a-z0-9 ,'./_-]{0,160}$/iu.test(error?.message ?? "") ? error.message : null,
        },
      }),
    );
    throw error;
  });
};
const connection = {
  host: "127.0.0.1",
  port: config.ports.postgres,
  user: config.database.user,
  password: config.database.password,
  database,
};
const { createPostgresPersistence } = await import(path.join(app, "packages/persistence-postgres/dist/index.js"));
const { createOrderPaymentApplication } = await import(path.join(app, "packages/application/dist/index.js"));
const persistence = createPostgresPersistence({ ...connection, application_name: "payment-diagnosis" });
const db = new pg.Client(connection);
await db.connect();
try {
  const waiting = (
    await db.query(
      `SELECT s.provider_event_id id, s.attempt_count n FROM order_payment_application_schedule s
        WHERE NOT EXISTS (SELECT 1 FROM order_payment_application_receipts r WHERE r.provider_event_id=s.provider_event_id)
        ORDER BY s.attempt_count DESC`,
    )
  ).rows;
  console.log(JSON.stringify({ database: live ? "live" : "scratch", waiting: waiting.map((row) => Number(row.n)) }));
  const payments = createOrderPaymentApplication({ transactions: persistence.orderPaymentApplicationTransactionManager });
  for (const { id } of waiting.slice(0, limit)) {
    try {
      const result = await payments.apply({
        schemaVersion: 1,
        providerEventId: id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
        taskName: "order-payment-application",
      });
      console.log(JSON.stringify({ decision: result.decision, outcome: result.outcome ?? null }));
    } catch (error) {
      console.log(JSON.stringify({ applyFailed: error?.code ?? error?.name }));
    }
  }
} finally {
  await db.end();
  await persistence.close();
}
