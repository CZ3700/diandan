import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
const root = new URL("../../../database/migrations/", import.meta.url);
const sql = (name: string) =>
  readFile(new URL(name, root), "utf8").catch(() => "");
test("new checkout evidence is append-only and failed rollback cannot discard observations or orders", async () => {
  const up = await sql("0025_checkout-preflight.up.sql"),
    down = await sql("0025_checkout-preflight.down.sql");
  for (const name of [
    "checkout_preflight_observations",
    "checkout_preflight_receipts",
    "checkout_outbox_events",
  ]) {
    expect(up).toContain(`CREATE TABLE public.${name}`);
    expect(down).toContain(`SELECT 1 FROM public.${name}`);
  }
  expect(down).toContain("USING ERRCODE = '55000'");
  expect(up).toContain("guard_append_only()");
});
test("the historical order snapshot validator remains exact behind the new explicit version dispatch", async () => {
  const old = await sql("0004_orders-fulfillment.up.sql"),
    current = await sql("0025_checkout-preflight.up.sql");
  const pattern =
    /CREATE(?: OR REPLACE)? FUNCTION (?:public\.)?validate_order_item_snapshot\(\)[\s\S]*?\$\$;/u;
  const oldGuard = old.match(pattern)?.[0];
  expect(oldGuard).toBeDefined();
  expect(
    current
      .match(pattern)?.[0]
      ?.replace("CREATE OR REPLACE FUNCTION public.", "CREATE FUNCTION ")
      .replace(/ {2}IF NEW.schema_version = 2 THEN[\s\S]*? {2}END IF;\n/u, ""),
  ).toBe(oldGuard);
});
