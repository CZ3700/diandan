// Read-only status of daily management operations on a remote TEST instance: recent operations with
// their phase, failure code and attempts, plus the media processing jobs behind them. Only status
// columns are printed (no names, texts, object keys, PII or secrets).
// Usage (as the runtime user): INSTANCE=stg HOURS=24 node management-status.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const app = process.env.APP_ROOT ?? "/home/xiadan/app";
const instance = process.env.INSTANCE ?? "stg";
const hours = Number(process.env.HOURS ?? 24);
const { Client } = require(require.resolve("pg", { paths: [path.join(app, "packages/persistence-postgres")] }));
const config = require(path.join(app, "node_modules/.cache/fan-support-local-experience", instance, "config.json"));

(async () => {
  const db = new Client({
    host: "127.0.0.1",
    port: config.ports.postgres,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const show = async (label, sql) => {
    console.log(`== ${label}`);
    for (const row of (await db.query(sql, [hours])).rows) console.log(JSON.stringify(row));
  };
  await show(
    "management operations",
    `SELECT created_at::text created, updated_at::text updated, intent->>'kind' kind, (intent->>'id') IS NULL is_new,
        status, phase, failure_code, failure_retryable retryable, attempt_count attempts, lease_expires_at::text lease
      FROM management_operations WHERE created_at > now()-make_interval(hours=>$1) ORDER BY created_at`,
  );
  await show(
    "media processing jobs",
    `SELECT created_at::text created, updated_at::text updated, role, fit, status, attempt_count attempts,
        error_code, error_retryable retryable, source_asset_id source
      FROM media_processing_jobs WHERE created_at > now()-make_interval(hours=>$1) ORDER BY created_at`,
  );
  await db.query("ROLLBACK");
  await db.end();
})().catch((error) => {
  console.error("management status failed", error?.code ?? error?.name);
  process.exit(1);
});
