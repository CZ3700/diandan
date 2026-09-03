import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

async function migration(name: string): Promise<string> {
  return readFile(
    path.join(workspaceRoot, "database/migrations", name),
    "utf8",
  );
}

test("uses one contract-shaped idempotency key domain for every business key", async () => {
  const migrations = await Promise.all([
    migration("0001_foundation-security.up.sql"),
    migration("0002_content-catalog.up.sql"),
    migration("0003_inventory-cart-private-data.up.sql"),
    migration("0004_orders-fulfillment.up.sql"),
    migration("0005_payments-reliable-events.up.sql"),
    migration("0006_publication-heads-outbox.up.sql"),
  ]);

  expect(migrations[0]).toContain(
    "CREATE DOMAIN idempotency_key_value AS text",
  );
  expect(migrations[0]).toContain("VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'");
  expect(
    migrations.join("\n").match(/idempotency_key idempotency_key_value/g),
  ).toHaveLength(7);
});

test("keeps object keys and provider references opaque at the database boundary", async () => {
  const foundation = await migration("0001_foundation-security.up.sql");
  const content = await migration("0002_content-catalog.up.sql");
  const orders = await migration("0004_orders-fulfillment.up.sql");
  const mediaObjectKeyUpgrade = await migration(
    "0008_media-object-key-segments.up.sql",
  );

  expect(foundation).toContain("CREATE DOMAIN media_object_key AS text");
  expect(foundation).toContain("VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'");
  expect(foundation).toContain("VALUE !~ '(^|/)\\.\\.(/|$)'");
  expect(mediaObjectKeyUpgrade).toContain("VALUE !~ '(^|/)\\.{1,2}(/|$)'");
  expect(content.match(/object_key media_object_key NOT NULL/g)).toHaveLength(
    2,
  );
  expect(orders).toContain(
    "idol_portrait_object_key media_object_key NOT NULL",
  );
  expect(orders).toContain("gift_image_object_key media_object_key NOT NULL");

  expect(foundation).toContain(
    "CREATE DOMAIN opaque_provider_reference AS text",
  );
  expect(foundation).toContain("VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'");
  expect(orders).toContain(
    "provider_delivery_reference opaque_provider_reference",
  );
});

test("rejects infinite values for security and business expiry timestamps", async () => {
  const foundation = await migration("0001_foundation-security.up.sql");
  const inventory = await migration("0003_inventory-cart-private-data.up.sql");
  const orders = await migration("0004_orders-fulfillment.up.sql");
  const payments = await migration("0005_payments-reliable-events.up.sql");

  expect(foundation).toContain(
    "CREATE DOMAIN finite_timestamptz AS timestamptz",
  );
  expect(foundation).toContain("CHECK (isfinite(VALUE))");
  expect(
    foundation.match(/expires_at finite_timestamptz NOT NULL/g),
  ).toHaveLength(2);
  expect(
    inventory.match(/expires_at finite_timestamptz NOT NULL/g),
  ).toHaveLength(5);
  expect(inventory).toContain("quote_expires_at finite_timestamptz NOT NULL");
  expect(orders.match(/expires_at finite_timestamptz NOT NULL/g)).toHaveLength(
    3,
  );
  expect(payments).toContain("action_expires_at finite_timestamptz");
  expect(payments).toContain(
    "return_state_expires_at finite_timestamptz NOT NULL",
  );
  expect(payments).toContain(
    "retention_expires_at finite_timestamptz NOT NULL",
  );
});

test("pins safety domains in the committed PostgreSQL catalog", async () => {
  const catalog = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "database/schema/expected-catalog.json"),
      "utf8",
    ),
  ) as Readonly<{
    domainConstraints: readonly Readonly<{
      domain: string;
      name: string;
      definition: string;
    }>[];
    columns: readonly Readonly<{
      table: string;
      name: string;
      dataType: string;
    }>[];
  }>;
  const expected = [
    ["idempotency_records", "idempotency_key", "idempotency_key_value"],
    ["content_publications", "idempotency_key", "idempotency_key_value"],
    ["inventory_ledger", "idempotency_key", "idempotency_key_value"],
    ["notification_deliveries", "idempotency_key", "idempotency_key_value"],
    ["refunds", "idempotency_key", "idempotency_key_value"],
    ["outbox_events", "idempotency_key", "idempotency_key_value"],
    ["price_book_publications", "idempotency_key", "idempotency_key_value"],
    ["media_assets", "object_key", "media_object_key"],
    ["media_variants", "object_key", "media_object_key"],
    ["order_items", "idol_portrait_object_key", "media_object_key"],
    ["order_items", "gift_image_object_key", "media_object_key"],
    [
      "notification_delivery_attempts",
      "provider_delivery_reference",
      "opaque_provider_reference",
    ],
    ["admin_sessions", "expires_at", "finite_timestamptz"],
    ["support_intents", "expires_at", "finite_timestamptz"],
    ["payment_attempts", "return_state_expires_at", "finite_timestamptz"],
  ] as const;

  for (const [table, name, dataType] of expected) {
    expect(catalog.columns).toContainEqual(
      expect.objectContaining({ table, name, dataType }),
    );
  }

  expect(catalog.domainConstraints).toContainEqual(
    expect.objectContaining({
      domain: "media_object_key",
      name: "media_object_key_check",
      definition: expect.stringContaining("(^|/)\\.{1,2}(/|$)"),
    }),
  );
});
