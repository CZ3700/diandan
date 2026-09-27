// Read-only payment status of a remote TEST instance: recent attempts with order, fulfillment and
// cart state, webhook processing outcomes, the payment-application backlog and the schema head.
// Connection parameters stay on the server; only status columns are printed (no PII, no secrets).
// Usage (as the runtime user): INSTANCE=stg node payment-status.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const app = process.env.APP_ROOT ?? "/home/xiadan/app";
const instance = process.env.INSTANCE ?? "stg";
const { Client } = require(require.resolve("pg", { paths: [path.join(app, "packages/persistence-postgres")] }));
const config = require(path.join(app, "node_modules/.cache/fan-support-local-experience", instance, "config.json"));

(async () => {
  const db = new Client({
    host: "127.0.0.1",
    port: config.ports.postgres,
    user: config.database.user,
    password: config.database.password,
    database: process.env.DIAG_DB ?? config.database.database,
  });
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const show = async (label, sql) => {
    console.log(`== ${label}`);
    for (const row of (await db.query(sql)).rows) console.log(JSON.stringify(row));
  };
  await show(
    "payment attempts (last 6h)",
    `SELECT a.created_at::text created, a.status attempt, o.payment_status pay, o.order_status ord,
        o.fulfillment_status ful, c.status cart,
        (SELECT string_agg(coalesce(i.gift_kind,'NULL')||':'||f.status, ',' ORDER BY i.created_at)
           FROM order_items i JOIN fulfillments f ON f.order_item_id=i.id WHERE i.order_id=o.id) lines
      FROM payment_attempts a JOIN orders o ON o.id=a.order_id JOIN carts c ON c.id=o.cart_id
      WHERE a.created_at > now()-interval '6 hours' ORDER BY a.created_at`,
  );
  await show(
    "webhook processing outcomes (last 6h)",
    `SELECT outcome, error_code, count(*) n, max(attempt_number) max_attempt
      FROM webhook_processing_attempts WHERE started_at > now()-interval '6 hours' GROUP BY 1,2 ORDER BY 3 DESC`,
  );
  await show(
    "payment observations still waiting for an application receipt",
    `SELECT count(*) n, max(s.attempt_count) max_attempts FROM order_payment_application_schedule s
      WHERE NOT EXISTS (SELECT 1 FROM order_payment_application_receipts r WHERE r.provider_event_id=s.provider_event_id)`,
  );
  await show("schema head", "SELECT max(version) v FROM schema_migrations");
  await db.query("ROLLBACK");
  await db.end();
})().catch((error) => {
  console.error("payment status failed", error?.code ?? error?.name);
  process.exit(1);
});
