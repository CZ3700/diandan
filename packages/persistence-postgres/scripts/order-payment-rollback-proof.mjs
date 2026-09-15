import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { runMigrations } from "../dist/index.js";
const tables = [
  "schema_migrations",
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
  "payment_attempts",
  "payment_attempt_events",
  "payment_create_receipts",
  "payment_runtime_operations",
  "payment_reconcile_receipts",
  "order_payment_application_receipts",
  "order_payment_application_schedule",
  "webhook_inbox",
  "webhook_processing_attempts",
  "webhook_effects",
  "provider_events",
  "provider_event_associations",
  "payment_transactions",
  "audit_logs",
  "outbox_events",
  "idempotency_records",
];
async function snapshot(client) {
  const result = {};
  for (const table of tables) {
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
/** The TEST caller quiesces its recovery loop. Raw actions, keys, contact and message rows never leave this helper. */
export async function verifyOrderPaymentRollbackProtection({
  clientConfig,
  workspaceRoot,
}) {
  const client = new Client(clientConfig);
  await client.connect();
  let open = false;
  try {
    assert.equal(
      (
        await client.query(
          "SELECT max(version) version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0028",
    );
    const orderAccessDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0028" },
    });
    assert.deepEqual(
      [orderAccessDown.revertedVersions, orderAccessDown.currentVersion],
      [["0028"], "0027"],
      "empty order-access migration rolls back before preserved history probes",
    );
    const before = await snapshot(client);
    assert.ok(
      before.order_payment_application_receipts.count > 0,
      "real order-payment application receipts must exist",
    );
    assert.ok(
      before.payment_attempts.count > 0 &&
        before.payment_attempt_events.count > 0,
      "actual attempts and events must exist",
    );
    await client.query("BEGIN");
    open = true;
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0027_order-payment-application.down.sql",
      ),
      "utf8",
    );
    let rejected = false;
    try {
      await client.query(down);
    } catch (error) {
      rejected =
        error.code === "55000" &&
        error.message ===
          "order payment application evidence prevents rollback";
    }
    await client.query("ROLLBACK");
    open = false;
    assert.equal(rejected, true, "exact immutable runtime guard refuses down");
    assert.deepEqual(
      await snapshot(client),
      before,
      "direct SQL rejection preserves all table counts and hashes",
    );
    await assert.rejects(
      runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0027" },
      }),
      {
        name: "MigrationExecutionError",
        message: "migration 0027 down failed",
      },
    );
    const after = await snapshot(client);
    assert.deepEqual(
      after,
      before,
      "normal migration rejection preserves financial and private history",
    );
    assert.equal(
      (
        await client.query(
          "SELECT max(version) version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0027",
    );
    const restored = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    assert.equal(restored.currentVersion, "0028");
    return {
      schemaVersion: 1,
      status: "PASS",
      assertions: 10,
      tableCount: tables.length,
      before,
      after,
      scope:
        "Existing TEST order-payment application receipts prevent destructive 0027 rollback; no status, keys or raw rows emitted",
    };
  } finally {
    if (open) await client.query("ROLLBACK");
    await client.end();
  }
}
