import { expect, test, vi } from "vitest";
const version = "a".repeat(64);
test("SEO SQL enumerates stable owner keys without market or offset and bounds only the requested hydration window", async () => {
  const module = await import("./storefront-seo-data.js").catch(
    () => undefined,
  );
  expect(module, "bounded SEO SQL must exist").toBeDefined();
  if (!module) return;
  const statement = module.storefrontSeoIndexQuery("INDEX", "3:privacy");
  expect(statement.values).toEqual(["3:privacy", 21]);
  expect(statement.text).toContain("LIMIT $2");
  expect(statement.text).not.toMatch(
    /\bOFFSET\b|public\.(prices|price_books|inventory_balances)|translation/u,
  );
  expect(statement.text).toContain("status IN ('active','paused')");
  expect(statement.text).toContain("proof_version=2");
  expect(statement.text).toContain("replaces_publication_id");
  const catalog = module.storefrontSeoIndexQuery("CATALOG", null);
  expect(catalog.values).toEqual([null, 51]);
  expect(catalog.text).toContain("lag(last_key)");
});
test("repository never treats malformed or failed SQL as an empty catalogue; changed and unknown cursors are explicit", async () => {
  const module = await import("./storefront-seo-data.js").catch(
    () => undefined,
  );
  expect(module).toBeDefined();
  if (!module) return;
  const query = vi.fn(async () => ({
    rows: [{ catalog_version: version, cursor_found: true, entries: [] }],
  }));
  const client = { query, release: vi.fn() };
  expect(
    await module.readStorefrontSeoSnapshot(client, "INDEX", undefined),
  ).toMatchObject({ outcome: "SUCCESS", candidates: [], hasNextPage: false });
  const cursor = {
    schemaVersion: 1,
    operation: "INDEX",
    catalogVersion: "b".repeat(64),
    afterKey: null,
  } as const;
  expect(
    await module.readStorefrontSeoSnapshot(client, "INDEX", cursor),
  ).toMatchObject({ code: "CATALOG_CHANGED" });
  query.mockResolvedValue({
    rows: [{ catalog_version: version, cursor_found: false, entries: [] }],
  });
  expect(
    await module.readStorefrontSeoSnapshot(client, "INDEX", {
      ...cursor,
      catalogVersion: version,
      afterKey: "3:missing",
    }),
  ).toMatchObject({ code: "INVALID_CURSOR" });
  query.mockResolvedValue({ rows: [] });
  await expect(
    module.readStorefrontSeoSnapshot(client, "INDEX", undefined),
  ).rejects.toThrow();
  query.mockRejectedValue(new Error("database unavailable"));
  await expect(
    module.readStorefrontSeoSnapshot(client, "INDEX", undefined),
  ).rejects.toThrow();
});
