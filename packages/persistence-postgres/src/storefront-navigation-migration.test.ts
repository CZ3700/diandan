import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("navigation has an independent append-only migration and protects populated history on downgrade", () => {
  const directory = new URL("../../../database/migrations/", import.meta.url);
  const up = new URL("0048_storefront-navigation.up.sql", directory);
  const down = new URL("0048_storefront-navigation.down.sql", directory);
  expect(existsSync(fileURLToPath(up))).toBe(true);
  expect(existsSync(fileURLToPath(down))).toBe(true);
  const sql = readFileSync(up, "utf8");
  for (const table of ["heads", "revisions", "publications", "receipts"])
    expect(sql).toContain(`CREATE TABLE storefront_navigation_${table}`);
  expect(sql).toContain("CHECK(valid_storefront_navigation(navigation))");
  expect(sql).not.toContain("UPDATE storefront_theme");
  expect(sql).not.toContain("UPDATE homepage_layout");
  expect(readFileSync(down, "utf8")).toContain(
    "navigation history cannot be downgraded",
  );
});
