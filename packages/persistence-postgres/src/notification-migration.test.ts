import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const migration = (direction: string) =>
  readFile(
    new URL(
      `../../../database/migrations/0029_notifications.${direction}.sql`,
      import.meta.url,
    ),
    "utf8",
  ).catch(() => "");

test("notification retries retain source identity, immutable content and fenced contact access", async () => {
  const sql = await migration("up");
  for (const name of [
    "notification_runtime_state",
    "notification_contact_access_receipts",
  ])
    expect(sql).toContain(`CREATE TABLE public.${name}`);
  for (const name of [
    "notification_runtime_immutable",
    "notification_runtime_consistency",
    "notification_contact_access_authority",
  ])
    expect(sql).toContain(name);
  expect(sql).toContain("dedupe_until");
  expect(sql).toContain("content_hash");
  expect(sql).not.toMatch(
    /\b(?:recipient_email|rendered_html|raw_token)\s+(?:text|jsonb)/u,
  );
});

test("bootstrap preserves one active public link without allowing an unconsumed internal grant", async () => {
  const sql = await migration("up");
  expect(sql).toContain("CHECKOUT_BOOTSTRAP");
  expect(sql).toContain("order_access_bootstrap_complete");
  expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  expect(sql).toMatch(/WHERE status = 'ACTIVE' AND purpose = 'LINK'/u);
});

test("notification rollback preserves durable evidence and restores prior order authority", async () => {
  const sql = await migration("down");
  expect(sql).toContain(
    "notification rollback would discard durable notification or bootstrap history",
  );
  expect(sql.indexOf("RAISE EXCEPTION")).toBeGreaterThan(-1);
  expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
    sql.indexOf("DROP TABLE"),
  );
  const original = await readFile(
    new URL(
      "../../../database/migrations/0004_orders-fulfillment.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const fn = original.slice(
    original.indexOf("CREATE FUNCTION validate_order_event()"),
    original.indexOf("CREATE FUNCTION assert_order_event_head()"),
  );
  expect(sql).toContain(
    fn
      .replace(
        "CREATE FUNCTION validate_order_event()",
        "CREATE OR REPLACE FUNCTION public.validate_order_event()",
      )
      .trim(),
  );
});

test("historical notification validation adds exact persisted source evidence while retaining legacy checks", async () => {
  const up = await migration("up"),
    down = await migration("down");
  expect(up).toContain(
    "CREATE OR REPLACE FUNCTION public.validate_notification_delivery()",
  );
  expect(up).toContain(
    "runtime.notification_delivery_id=NEW.id AND source.order_id=o.id AND source.event_type=NEW.event_type",
  );
  expect(up).toContain("o.fulfillment_status IN ('PREPARING', 'DELIVERED')");
  expect(down).toContain(
    "CREATE OR REPLACE FUNCTION public.validate_notification_delivery()",
  );
});
