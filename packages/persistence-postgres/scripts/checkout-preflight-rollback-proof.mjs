import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { runMigrations } from "../dist/index.js";
import { rollbackEmptyNotifications } from "./notification-rollback-prefix.mjs";

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
    assert.equal(
      (
        await client.query(
          "SELECT max(version) version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0029",
    );
    await rollbackEmptyNotifications({ client, clientConfig, workspaceRoot });
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
    const orderPaymentDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0027" },
    });
    assert.deepEqual(
      [orderPaymentDown.revertedVersions, orderPaymentDown.currentVersion],
      [["0027"], "0026"],
    );
    const paymentDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0026" },
    });
    assert.deepEqual(
      [paymentDown.revertedVersions, paymentDown.currentVersion],
      [["0026"], "0025"],
    );
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
    assert.deepEqual(
      await snapshot(client),
      before,
      "direct SQL rejection preserves all 21 table counts and bytes",
    );
    await assert.rejects(
      runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0025" },
      }),
      {
        name: "MigrationExecutionError",
        message: "migration 0025 down failed",
      },
    );
    const after = await snapshot(client);
    assert.deepEqual(
      after,
      before,
      "normal migration runner rejection preserves every checkout, inventory and private record",
    );
    const restored = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    assert.equal(restored.currentVersion, "0029");
    return {
      schemaVersion: 1,
      status: "PASS",
      assertions: 14,
      scope:
        "Accepted checkout blocks destructive 0025 rollback; 21 table counts and hashes remain exact",
      before,
      after,
    };
  } finally {
    if (open) await client.query("ROLLBACK");
    await client.end();
  }
}
