import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
const root = new URL("../../../database/migrations/", import.meta.url);
test("order administration retains private, review and fulfillment authority as immutable receipts", async () => {
  const sql = await readFile(
    new URL("0031_admin-orders.up.sql", root),
    "utf8",
  ).catch(() => "");
  for (const name of [
    "admin_order_message_locale_grants",
    "admin_order_private_accesses",
    "admin_order_private_confirmations",
    "admin_order_message_reviews",
    "admin_order_notes",
    "admin_order_operation_receipts",
    "admin_order_fulfillment_receipts",
  ])
    expect(sql).toContain(`CREATE TABLE public.${name}`);
  expect(sql).toContain(
    "CREATE CONSTRAINT TRIGGER admin_order_review_complete",
  );
  expect(sql).toContain("guard_append_only");
});
test("rollback rejects retained operations before dropping their authority", async () => {
  const sql = await readFile(
    new URL("0031_admin-orders.down.sql", root),
    "utf8",
  ).catch(() => "");
  expect(sql).toContain("admin order history cannot be downgraded");
  expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
    sql.indexOf("DROP TABLE"),
  );
});

test("converted private reviews and new admin fulfillment authority cannot omit receipts", async () => {
  const sql = await readFile(new URL("0031_admin-orders.up.sql", root), "utf8");
  expect(sql).toContain(
    "CREATE CONSTRAINT TRIGGER admin_order_human_review_required",
  );
  expect(sql).toContain(
    "CREATE CONSTRAINT TRIGGER admin_order_admin_event_required",
  );
  expect(sql).toContain("CREATE CONSTRAINT TRIGGER admin_order_note_complete");
});
