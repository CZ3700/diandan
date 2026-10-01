import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

async function snapshot(client) {
  const result = {};
  for (const table of [
    "carts",
    "cart_items",
    "support_intents",
    "customer_contacts",
    "checkout_preflight_observations",
    "checkout_preflight_receipts",
    "checkout_outbox_events",
    "checkout_sessions",
    "checkout_quote_lines",
    "orders",
    "order_items",
    "order_events",
    "policy_acceptances",
    "fulfillments",
    "fulfillment_events",
    "inventory_balances",
    "inventory_reservations",
    "inventory_ledger",
    "idempotency_records",
    "outbox_events",
    "media_processing_jobs",
    "schema_migrations",
  ]) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(record) value FROM public.${table} record ORDER BY to_jsonb(record)::text COLLATE "C"`,
      )
    ).rows;
    result[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
}
/** Reuses accepted application writes. No original rows or encrypted values leave this helper. */
export async function verifyCheckoutPreflightRollbackProtection({
  clientConfig,
  workspaceRoot,
}) {
  const client = new Client(clientConfig);
  await client.connect();
  let open = false;
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(workspaceRoot, "database/migrations/manifest.json"),
        "utf8",
      ),
    );
    const head = (
      await client.query(
        "SELECT max(version) version FROM public.schema_migrations",
      )
    ).rows[0]?.version;
    assert.equal(
      head,
      manifest.migrations.at(-1).version,
      "checkout rollback proof requires the latest manifest head",
    );
    // Accepted daily publication retains filled media jobs. Rewinding the later
    // migrations is both forbidden and unnecessary: exercise 0025's own guard at
    // the current schema, then roll back the probe without changing migration history.
    const before = await snapshot(client);
    assert.ok(
      before.checkout_preflight_receipts.count > 0,
      "normal accepted checkout must exist",
    );
    assert.ok(
      before.orders.count > 0 && before.order_items.count > 0,
      "real immutable order history must exist",
    );
    assert.equal(
      before.checkout_outbox_events.count,
      before.checkout_preflight_receipts.count,
    );
    const filledMediaJobs = Number(
      (
        await client.query(
          "SELECT count(*)::text AS count FROM public.media_processing_jobs WHERE fit='COVER_ALLOW_ENLARGE'",
        )
      ).rows[0]?.count,
    );
    assert.ok(
      Number.isSafeInteger(filledMediaJobs) && filledMediaJobs >= 0,
      "filled media history count is known",
    );
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0025_checkout-preflight.down.sql",
      ),
      "utf8",
    );
    await client.query("BEGIN");
    open = true;
    let rejected = false;
    try {
      await client.query(down);
    } catch (error) {
      rejected =
        error.code === "55000" &&
        error.message ===
          "checkout rollback would discard observations or immutable checkout history";
    }
    await client.query("ROLLBACK");
    open = false;
    assert.equal(
      rejected,
      true,
      "exact immutable checkout history guard refuses down",
    );
    const after = await snapshot(client);
    assert.deepEqual(
      after,
      before,
      "direct SQL rejection preserves all 22 table counts and bytes",
    );
    assert.equal(
      (
        await client.query(
          "SELECT max(version) version FROM public.schema_migrations",
        )
      ).rows[0]?.version,
      head,
      "direct checkout guard proof leaves the migration head unchanged",
    );
    return {
      schemaVersion: 1,
      status: "PASS",
      proof: "CURRENT_SCHEMA_DIRECT_SQL",
      migrationHead: head,
      guards: ["0025"],
      filledMediaJobs,
      assertions: 8,
      scope:
        "Accepted checkout blocks destructive 0025 down SQL at the current schema; 22 table counts and hashes remain exact",
      before,
      after,
    };
  } finally {
    try {
      if (open) await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}
