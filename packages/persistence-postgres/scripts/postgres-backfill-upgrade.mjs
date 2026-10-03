#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  EphemeralPostgresError,
  MigrationExecutionError,
  MigrationManifestError,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

class BackfillUpgradeHarnessError extends Error {}

function fail(message) {
  throw new BackfillUpgradeHarnessError(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} did not match`);
}

/** Only SQLSTATE and schema object names leave the harness, never values. */
function safeDatabaseFailure(error) {
  const name = (value) =>
    typeof value === "string" && /^[a-z_][a-z_0-9]{0,127}$/u.test(value)
      ? value
      : null;
  return JSON.stringify({
    code:
      typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code)
        ? error.code
        : null,
    constraint: name(error?.constraint),
    table: name(error?.table),
    column: name(error?.column),
  });
}

// The migration runner reports only its version, so remember the last database failure's safe shape.
let lastDatabaseFailure = null;
const query = Client.prototype.query;
Client.prototype.query = function (...args) {
  const result = query.apply(this, args);
  if (!result?.catch) return result;
  return result.catch((error) => {
    lastDatabaseFailure = safeDatabaseFailure(error);
    throw error;
  });
};

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The ephemeral PostgreSQL instance is the final cleanup boundary.
  }
}

/** Replica role skips foreign-key and guard triggers so bare rows can stand in for history. */
async function runReplicaTransaction(client, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function insertRow(client, table, row, label) {
  const columns = Object.keys(row);
  try {
    await client.query(
      `INSERT INTO public.${table}(${columns.join(",")}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(",")})`,
      Object.values(row),
    );
  } catch (error) {
    fail(`${label} seed failed ${safeDatabaseFailure(error)}`);
  }
}

const checksum = "a".repeat(64);

/** One paid-looking order, its line and a frozen notification, as a 0037 database holds them. */
async function seedHistory(client) {
  const orderId = randomUUID();
  const deliveryId = randomUUID();
  await insertRow(
    client,
    "orders",
    {
      id: orderId,
      public_order_id: randomUUID(),
      checkout_session_id: randomUUID(),
      checkout_quote_id: randomUUID(),
      cart_id: randomUUID(),
      customer_contact_id: randomUUID(),
      presentation_locale: "en",
      market: "TEST",
      currency: "USD",
      quote_revision: 1,
      quote_expires_at: "2099-01-01T00:00:00Z",
      subtotal_minor: 100,
      total_amount_minor: 100,
      order_status: "DRAFT",
      payment_status: "UNPAID",
      dispute_status: "NONE",
      fulfillment_status: "PENDING",
    },
    "order",
  );
  const locale = (prefix) => ({
    [`${prefix}_requested_locale`]: "en",
    [`${prefix}_resolved_locale`]: "en",
    [`${prefix}_fallback_used`]: false,
  });
  await insertRow(
    client,
    "order_items",
    {
      id: randomUUID(),
      schema_version: 1,
      order_id: orderId,
      cart_item_id: randomUUID(),
      support_intent_id: randomUUID(),
      idol_id: randomUUID(),
      idol_handle: "test-idol",
      idol_display_name: "Test Idol",
      idol_translation_revision_id: randomUUID(),
      ...locale("idol_translation"),
      idol_portrait_asset_id: randomUUID(),
      idol_portrait_checksum_sha256: checksum,
      idol_portrait_object_key: `processed/v1/${checksum}/portrait.webp`,
      idol_portrait_metadata_revision_id: randomUUID(),
      idol_portrait_alt: "Test portrait",
      idol_portrait_alt_translation_revision_id: randomUUID(),
      ...locale("idol_portrait_alt"),
      gift_id: randomUUID(),
      gift_variant_id: randomUUID(),
      gift_title: "Test gift",
      gift_translation_revision_id: randomUUID(),
      ...locale("gift_translation"),
      gift_image_asset_id: randomUUID(),
      gift_image_checksum_sha256: checksum,
      gift_image_object_key: `processed/v1/${checksum}/gift.webp`,
      gift_image_metadata_revision_id: randomUUID(),
      gift_image_alt: "Test gift image",
      gift_image_alt_translation_revision_id: randomUUID(),
      ...locale("gift_image_alt"),
      price_id: randomUUID(),
      price_revision: 1,
      quantity: 1,
      unit_amount_minor: 100,
      line_subtotal_minor: 100,
      line_total_minor: 100,
      currency: "USD",
      display_mode: "anonymous",
    },
    "order line",
  );
  await insertRow(
    client,
    "notification_deliveries",
    {
      id: deliveryId,
      order_id: orderId,
      customer_contact_id: randomUUID(),
      event_type: "PAYMENT_CONFIRMED",
      requested_locale: "en",
      resolved_locale: "en",
      fallback_used: false,
      template_key: "order.payment.confirmed",
      template_version: "v1",
      idempotency_key: `backfill-upgrade:${deliveryId}`,
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      status: "REQUESTED",
    },
    "notification delivery",
  );
  await insertRow(
    client,
    "notification_runtime_state",
    {
      notification_delivery_id: deliveryId,
      source_outbox_event_id: randomUUID(),
      event_rank: 1,
      base_variables: JSON.stringify({ schemaVersion: 1, siteName: "TEST" }),
      public_storefront_origin: "https://shop.example.test",
      transport_key: checksum,
      contact_lookup_hmac: Buffer.alloc(32, 1),
      contact_lookup_key_version: "test-v1",
      link_nonce: Buffer.alloc(32, 2),
      link_pepper_version: "test-v1",
      link_ttl_seconds: 3600,
      dedupe_until: "2026-01-02T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    "notification runtime state",
  );
  return orderId;
}

async function migrate(clientConfig, command) {
  return runMigrations({ clientConfig, workspaceRoot, command });
}

async function runHarness(clientConfig) {
  const client = new Client(clientConfig);
  await client.connect();
  try {
    await migrate(clientConfig, { direction: "up", targetVersion: "0037" });
    const orderId = await runReplicaTransaction(client, () =>
      seedHistory(client),
    );
    // Each backfill must suspend every deferred user trigger it would queue:
    // re-enabling a trigger with pending events fails with SQLSTATE 55006.
    for (const version of ["0038", "0039", "0040"]) {
      let upgraded;
      try {
        upgraded = await migrate(clientConfig, {
          direction: "up",
          targetVersion: version,
        });
      } catch (error) {
        fail(
          `upgrade to ${version} with retained order and notification history failed ${error instanceof MigrationExecutionError ? lastDatabaseFailure : safeDatabaseFailure(error)}`,
        );
      }
      assertEqual(upgraded.currentVersion, version, `${version} upgrade head`);
    }
    const order = (
      await client.query(
        `SELECT o.public_order_no ~ '^FS-[0-9A-HJKMNP-TV-Z]{6}$' AS numbered,
          (SELECT count(*)::integer FROM public.order_items i WHERE i.order_id = o.id) AS lines,
          (SELECT r.base_variables->>'publicOrderNo' = o.public_order_no FROM public.notification_runtime_state r
            JOIN public.notification_deliveries d ON d.id = r.notification_delivery_id
            WHERE d.order_id = o.id) AS frozen_number
         FROM public.orders o WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0];
    assertEqual(
      order?.numbered,
      true,
      "retained order receives a short number",
    );
    assertEqual(order?.lines, 1, "retained order line survives the upgrade");
    assertEqual(
      order?.frozen_number,
      true,
      "retained notification variables are re-frozen with the short number",
    );
    return { version: "0040" };
  } finally {
    try {
      await client.end();
    } catch {
      // The ephemeral PostgreSQL harness owns process-level cleanup.
    }
  }
}

try {
  const result = await withEphemeralPostgres(async (clientConfig) => {
    try {
      return await runHarness(clientConfig);
    } catch (error) {
      // The ephemeral harness rewrites callback errors, so report the safe message here.
      if (
        error instanceof BackfillUpgradeHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError
      ) {
        console.error(error.message);
        throw new EphemeralPostgresError(error.message);
      }
      console.error(
        `PostgreSQL backfill upgrade runtime failure ${safeDatabaseFailure(error)}`,
      );
      throw new EphemeralPostgresError(
        "PostgreSQL backfill upgrade integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL backfill upgrade passed (0037 history upgraded to ${result.version} through every backfill).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL backfill upgrade integration failed";
  console.error(message);
  process.exitCode = 1;
}
