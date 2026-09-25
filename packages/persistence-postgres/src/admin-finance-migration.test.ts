import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
const root = new URL("../../../database/migrations/", import.meta.url);
test("financial commands retain immutable authorization and durable fenced recovery", async () => {
  const sql = await readFile(
    new URL("0035_admin-finance.up.sql", root),
    "utf8",
  ).catch(() => "");
  for (const table of [
    "admin_finance_operations",
    "admin_finance_receipts",
    "admin_finance_application_receipts",
    "admin_finance_application_schedule",
  ])
    expect(sql).toContain(`CREATE TABLE public.${table}`);
  expect(sql).toContain("finance.manage");
  expect(sql).toContain("admin_order_authorized");
  expect(sql).toContain("guard_append_only");
});
test("financial downgrade refuses retained commands and evidence", async () => {
  const sql = await readFile(
    new URL("0035_admin-finance.down.sql", root),
    "utf8",
  ).catch(() => "");
  expect(sql).toContain("financial operations history cannot be downgraded");
  expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
    sql.indexOf("DROP TABLE"),
  );
});
