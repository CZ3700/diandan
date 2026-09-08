import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
const up = new URL(
  "../../../database/migrations/0024_cart-edit-receipts.up.sql",
  import.meta.url,
);
const down = new URL(
  "../../../database/migrations/0024_cart-edit-receipts.down.sql",
  import.meta.url,
);
test("cart edit migration preserves prior guards and makes mutation/audit/event ownership immutable", async () => {
  const sql = await readFile(up, "utf8");
  for (const name of [
    "cart_item_mutation_receipts",
    "cart_private_access_receipts",
    "cart_edit_outbox_events",
  ]) {
    expect(sql).toContain(`CREATE TABLE public.${name}`);
    expect(sql).toContain(`BEFORE UPDATE OR DELETE ON public.${name}`);
    expect(sql).toContain(`BEFORE TRUNCATE ON public.${name}`);
  }
  expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  expect(sql).toContain("FOREIGN KEY (receipt_id,event_id)");
  expect(sql).toContain("status = 'PENDING'");
  expect(sql).not.toContain("CREATE OR REPLACE");
  expect(sql).not.toContain("ALTER TABLE public.support_intents");
});
test("rollback refuses retained edits/private audit evidence before any drop", async () => {
  const sql = await readFile(down, "utf8");
  expect(sql.indexOf("USING ERRCODE = '55000'")).toBeLessThan(
    sql.indexOf("DROP TABLE"),
  );
  for (const name of [
    "cart_item_mutation_receipts",
    "cart_private_access_receipts",
    "cart_edit_outbox_events",
  ])
    expect(sql).toContain(`EXISTS (SELECT 1 FROM public.${name})`);
});
