import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { runMigrations } from "../dist/index.js";
import { rollbackEmptyNotifications } from "./notification-rollback-prefix.mjs";

// Test-only verification against the caller's real, already-published fixture.
// Raw rows, credentials and ciphertext never enter the returned evidence.
async function snapshot(client) {
  const result = {};
  for (const table of [
    "carts",
    "cart_items",
    "support_intents",
    "outbox_events",
    "idempotency_records",
    "schema_migrations",
  ]) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(record) AS value FROM public.${table} record ORDER BY to_jsonb(record)::text COLLATE "C"`,
      )
    ).rows;
    result[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
}

export async function verifyCartRuntimeRollbackProtection({
  clientConfig,
  workspaceRoot,
  mode = "DYNAMIC",
}) {
  assert.ok(
    mode === "DYNAMIC" || mode === "PENDING",
    "rollback proof mode is explicit",
  );
  const client = new Client(clientConfig);
  await client.connect();
  let transactionOpen = false;
  try {
    const head = (
      await client.query(
        "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
      )
    ).rows[0]?.version;
    // The shared prefix guard rejects unknown heads or retained history.
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
    const editCounts = (
      await client.query(
        "SELECT (SELECT count(*) FROM public.cart_item_mutation_receipts)::integer mutations,(SELECT count(*) FROM public.cart_private_access_receipts)::integer accesses,(SELECT count(*) FROM public.cart_edit_outbox_events)::integer events",
      )
    ).rows[0];
    assert.deepEqual(
      editCounts,
      { mutations: 0, accesses: 0, events: 0 },
      "historical rollback proof cannot discard edit evidence",
    );
    const editDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0024" },
    });
    assert.deepEqual(
      [editDown.revertedVersions, editDown.currentVersion],
      [["0024"], "0023"],
    );
    const dynamicCount = Number(
      (
        await client.query(`SELECT count(*)::text AS count FROM public.cart_items item
      JOIN public.support_intents intent ON intent.cart_item_id=item.id
      JOIN public.gift_variant_recipient_rules rule ON rule.gift_variant_id=item.gift_variant_id AND rule.rule='ALL_ACTIVE_ARTISTS'
      WHERE NOT EXISTS (SELECT 1 FROM public.gift_variant_idol_eligibility explicit
        WHERE explicit.gift_variant_id=item.gift_variant_id AND explicit.idol_id=intent.idol_id)`)
      ).rows[0]?.count,
    );
    const count =
      mode === "DYNAMIC"
        ? dynamicCount
        : Number(
            (
              await client.query(
                `SELECT count(*)::text count FROM public.support_intents intent
       JOIN public.cart_items item ON item.id=intent.cart_item_id
       JOIN public.gift_variant_idol_eligibility explicit ON explicit.gift_variant_id=item.gift_variant_id AND explicit.idol_id=intent.idol_id
       WHERE intent.moderation_status='PENDING' AND intent.moderation_decision_kind IS NULL`,
              )
            ).rows[0]?.count,
          );
    if (mode === "PENDING")
      assert.equal(
        dynamicCount,
        0,
        "pending-only rollback proof cannot be satisfied by the dynamic rule guard",
      );
    assert.ok(
      Number.isSafeInteger(count) && count > 0,
      mode === "DYNAMIC"
        ? "fixture must contain a real accepted cart intent owned only through the daily rule"
        : "fixture must contain a real explicit-recipient pending intent without fabricated moderation",
    );
    const before = await snapshot(client);
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0023_cart-runtime-recipient-rules.down.sql",
      ),
      "utf8",
    );
    await client.query("BEGIN");
    transactionOpen = true;
    let rejected = false;
    try {
      await client.query(down);
    } catch (error) {
      rejected =
        error.code === "55000" &&
        error.message ===
          (mode === "DYNAMIC"
            ? "cart ownership requires the daily recipient rule migration"
            : "pending support intents require null-safe moderation validation");
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
    assert.equal(
      rejected,
      true,
      "the exact selected history guard must reject rollback",
    );
    assert.deepEqual(
      await snapshot(client),
      before,
      "direct rollback rejection preserves all cart and receipt rows",
    );
    await assert.rejects(
      runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0023" },
      }),
      {
        name: "MigrationExecutionError",
        message: "migration 0023 down failed",
      },
    );
    const after = await snapshot(client);
    assert.deepEqual(
      after,
      before,
      "the normal migration runner preserves all existing data after rejection",
    );
    const restored = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    assert.equal(
      restored.currentVersion,
      head,
      "restore the empty edit and checkout migrations after the exact legacy rollback proof",
    );
    return {
      schemaVersion: 1,
      status: "PASS",
      scope:
        mode === "DYNAMIC"
          ? "Existing daily-rule-only cart ownership blocks unsafe 0023 rollback"
          : "Existing pending moderation intents block unsafe 0023 rollback",
      mode,
      ...(mode === "DYNAMIC"
        ? { dynamicOnlyIntents: count }
        : { pendingIntents: count }),
      assertions: mode === "DYNAMIC" ? 16 : 17,
      before,
      after,
    };
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}
