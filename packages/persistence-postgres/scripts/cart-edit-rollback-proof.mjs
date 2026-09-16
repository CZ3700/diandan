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
    "cart_item_mutation_receipts",
    "cart_edit_outbox_events",
    "cart_private_access_receipts",
    "audit_logs",
    "outbox_events",
    "idempotency_records",
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
/** Uses the caller's normal accepted edit fixture; returns counts and hashes only. */
export async function verifyCartEditRollbackProtection({
  clientConfig,
  workspaceRoot,
}) {
  const client = new Client(clientConfig);
  await client.connect();
  let open = false;
  try {
    const head = (
      await client.query(
        "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
      )
    ).rows[0]?.version;
    assert.equal(head, "0029");
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
      "empty order-payment application rolls back before existing history probes",
    );
    const paymentDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0026" },
    });
    assert.deepEqual(
      [paymentDown.revertedVersions, paymentDown.currentVersion],
      [["0026"], "0025"],
      "empty payment runtime rolls back before preserved checkout history probes",
    );
    const checkoutDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0025" },
    });
    assert.deepEqual(
      [checkoutDown.revertedVersions, checkoutDown.currentVersion],
      [["0025"], "0024"],
    );
    const before = await snapshot(client);
    assert.ok(
      before.cart_item_mutation_receipts.count > 0,
      "actual accepted edits must exist",
    );
    assert.ok(
      before.cart_private_access_receipts.count > 0,
      "actual authorized private reads must exist",
    );
    assert.equal(
      before.cart_edit_outbox_events.count,
      before.cart_item_mutation_receipts.count,
      "one pending immutable event per accepted edit",
    );
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0024_cart-edit-receipts.down.sql",
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
          "cart edit rollback would discard mutation or private access evidence";
    }
    await client.query("ROLLBACK");
    open = false;
    assert.equal(rejected, true, "exact data-loss guard refuses down");
    assert.deepEqual(await snapshot(client), before);
    await assert.rejects(
      runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0024" },
      }),
      {
        name: "MigrationExecutionError",
        message: "migration 0024 down failed",
      },
    );
    const after = await snapshot(client);
    assert.deepEqual(after, before);
    const restored = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    assert.equal(restored.currentVersion, "0029");
    return {
      schemaVersion: 1,
      status: "PASS",
      assertions: 15,
      scope:
        "actual accepted edits and private audits block destructive rollback; all ten table counts and bytes preserved",
      before,
      after,
    };
  } finally {
    if (open) await client.query("ROLLBACK");
    await client.end();
  }
}
