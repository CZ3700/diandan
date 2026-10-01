import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { runMigrations } from "../dist/index.js";
import { rollbackEmptyNotifications } from "./notification-rollback-prefix.mjs";

// Test-only verification against the caller's real, already-published fixture.
// Raw rows, credentials and ciphertext never enter the returned evidence.
async function snapshot(client, additionalTables = []) {
  const result = {};
  for (const table of [
    "carts",
    "cart_items",
    "support_intents",
    "outbox_events",
    "idempotency_records",
    "schema_migrations",
    ...additionalTables,
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

// Normal daily publication retains 0041 media history, so it cannot be rewound
// to 0023. Probe the original guards transactionally at the current schema;
// the PENDING path below still exercises the runner with 0023 as the real head.
async function verifyPublishedDailyGuards({ client, workspaceRoot, head }) {
  const manifest = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "database/migrations/manifest.json"),
      "utf8",
    ),
  );
  assert.equal(
    head,
    manifest.migrations.at(-1).version,
    "daily guard proof requires the latest manifest head",
  );
  const dynamicOnlyIntents = Number(
    (
      await client.query(`SELECT count(*)::text AS count FROM public.cart_items item
      JOIN public.support_intents intent ON intent.cart_item_id=item.id
      JOIN public.gift_variant_recipient_rules rule ON rule.gift_variant_id=item.gift_variant_id AND rule.rule='ALL_ACTIVE_ARTISTS'
      WHERE NOT EXISTS (SELECT 1 FROM public.gift_variant_idol_eligibility explicit
        WHERE explicit.gift_variant_id=item.gift_variant_id AND explicit.idol_id=intent.idol_id)`)
    ).rows[0]?.count,
  );
  assert.ok(
    Number.isSafeInteger(dynamicOnlyIntents) && dynamicOnlyIntents > 0,
    "fixture must contain a real accepted cart intent owned only through the daily rule",
  );
  const filledMediaJobs = Number(
    (
      await client.query(
        "SELECT count(*)::text AS count FROM public.media_processing_jobs WHERE fit='COVER_ALLOW_ENLARGE'",
      )
    ).rows[0]?.count,
  );
  assert.ok(
    Number.isSafeInteger(filledMediaJobs) && filledMediaJobs > 0,
    "daily fixture must contain retained filled media processing history",
  );
  const dailyTables = [
    "gift_variant_recipient_rules",
    "gift_variant_idol_eligibility",
    "gifts",
    "gift_variants",
    "media_processing_jobs",
    "media_assets",
    "management_operations",
    "management_defaults",
    "daily_publication_revisions",
    "daily_publication_manifests",
    "audit_logs",
  ];
  const before = await snapshot(client, dailyTables);
  let after;
  const guards = [
    [
      "0023",
      "0023_cart-runtime-recipient-rules.down.sql",
      "cart ownership requires the daily recipient rule migration",
    ],
    [
      "0041",
      "0041_daily-image-fill.down.sql",
      "daily image fill rollback would discard filled media processing history",
    ],
  ];
  for (const [version, filename, message] of guards) {
    const down = await readFile(
      path.join(workspaceRoot, "database/migrations", filename),
      "utf8",
    );
    let rejected = false;
    await client.query("BEGIN");
    try {
      await client.query(down);
    } catch (error) {
      rejected = error.code === "55000" && error.message === message;
    } finally {
      await client.query("ROLLBACK");
    }
    assert.equal(
      rejected,
      true,
      `the exact ${version} history guard must reject rollback`,
    );
    after = await snapshot(client, dailyTables);
    assert.deepEqual(
      after,
      before,
      "direct SQL rejection preserves all cart, daily publication and media history",
    );
  }
  assert.equal(
    (
      await client.query(
        "SELECT max(version) AS version FROM public.schema_migrations",
      )
    ).rows[0]?.version,
    head,
    "direct historical guard probes preserve the current migration head",
  );
  return {
    schemaVersion: 1,
    status: "PASS",
    scope:
      "Existing daily-rule-only cart ownership and filled media block unsafe 0023 and 0041 rollback at the current schema",
    mode: "DYNAMIC",
    proof: "CURRENT_SCHEMA_DIRECT_SQL",
    migrationHead: head,
    guards: guards.map(([version]) => version),
    sqlState: "55000",
    dynamicOnlyIntents,
    filledMediaJobs,
    assertions: 8,
    before,
    after,
  };
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
  let step = "start";
  try {
    const head = (
      await client.query(
        "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
      )
    ).rows[0]?.version;
    if (mode === "DYNAMIC") {
      step = "current-schema daily ownership and media guards";
      return await verifyPublishedDailyGuards({ client, workspaceRoot, head });
    }
    // The shared prefix guard rejects unknown heads or retained history.
    step = "rewind to 0028";
    await rollbackEmptyNotifications({ client, clientConfig, workspaceRoot });
    step = "down 0028";
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
    step = "down 0027";
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
    step = "down 0026";
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
    step = "down 0025";
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
    step = "down 0024";
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
    const count = Number(
      (
        await client.query(
          `SELECT count(*)::text count FROM public.support_intents intent
       JOIN public.cart_items item ON item.id=intent.cart_item_id
       JOIN public.gift_variant_idol_eligibility explicit ON explicit.gift_variant_id=item.gift_variant_id AND explicit.idol_id=intent.idol_id
       WHERE intent.moderation_status='PENDING' AND intent.moderation_decision_kind IS NULL`,
        )
      ).rows[0]?.count,
    );
    assert.equal(
      dynamicCount,
      0,
      "pending-only rollback proof cannot be satisfied by the dynamic rule guard",
    );
    assert.ok(
      Number.isSafeInteger(count) && count > 0,
      "fixture must contain a real explicit-recipient pending intent without fabricated moderation",
    );
    const before = await snapshot(client);
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0023_cart-runtime-recipient-rules.down.sql",
      ),
      "utf8",
    );
    step = "0023 guard probe";
    await client.query("BEGIN");
    transactionOpen = true;
    let rejected = false;
    try {
      await client.query(down);
    } catch (error) {
      rejected =
        error.code === "55000" &&
        error.message ===
          "pending support intents require null-safe moderation validation";
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
    step = "restore current head";
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
      scope: "Existing pending moderation intents block unsafe 0023 rollback",
      mode,
      pendingIntents: count,
      assertions: 17,
      before,
      after,
    };
  } catch (error) {
    // The caller reports only RUNTIME or ASSERTION; name the step and the runner or
    // assertion message (fixed text, no row data) so a CI failure can be located.
    const fixedText =
      error?.name === "MigrationExecutionError" ||
      error?.name === "AssertionError";
    console.error(
      `Cart rollback proof diagnostic ${JSON.stringify({ mode, step, name: error?.name ?? null, code: typeof error?.code === "string" ? error.code : null, message: fixedText ? String(error.message).slice(0, 160) : null })}`,
    );
    throw error;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}
