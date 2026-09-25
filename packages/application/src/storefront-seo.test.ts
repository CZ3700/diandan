import { expect, test, vi } from "vitest";
import { createStorefrontSeoCursor } from "@fan-support/content";
import type {
  StorefrontSeoRepository,
  StorefrontSeoTransactionManager,
} from "@fan-support/persistence-port";
import { storefrontSeoPolicyFixture } from "./storefront-seo-fixtures.js";

const version = "a".repeat(64);
async function setup() {
  const module = await import("./storefront-seo.js").catch(() => undefined);
  expect(module, "the SEO application must exist").toBeDefined();
  if (!module) throw new Error("SEO application missing");
  const loadEntity = vi.fn<StorefrontSeoRepository["loadEntity"]>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: storefrontSeoPolicyFixture(),
  }));
  const readIndex = vi.fn<StorefrontSeoRepository["readIndex"]>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "INDEX",
    catalogVersion: version,
    candidates: [
      { key: "3:privacy", locator: { kind: "POLICY", policyKey: "privacy" } },
    ],
    hasNextPage: false,
  }));
  const readCatalog = vi.fn<StorefrontSeoRepository["readCatalog"]>(
    async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "CATALOG",
      catalogVersion: version,
      boundaries: [
        {
          firstKey: "3:privacy",
          lastKey: "3:privacy",
          afterKey: null,
          itemCount: 1,
        },
      ],
      hasNextPage: false,
    }),
  );
  const run = vi.fn<
    StorefrontSeoTransactionManager["runInStorefrontSeoTransaction"]
  >(async (work) =>
    work({ storefrontSeo: { loadEntity, readIndex, readCatalog } }),
  );
  return {
    app: module.createStorefrontSeoUseCases({
      transactions: {
        runInStorefrontSeoTransaction:
          run as StorefrontSeoTransactionManager["runInStorefrontSeoTransaction"],
      },
    }),
    loadEntity,
    readIndex,
    readCatalog,
    run,
  };
}
test("SEO application binds entity identity and verifies seven locales with one repository hydration", async () => {
  const { app, loadEntity } = await setup();
  const result = await app.execute({ schemaVersion: 1, operation: "INDEX" });
  expect(result.outcome).toBe("SUCCESS");
  expect(loadEntity).toHaveBeenCalledTimes(1);
  expect(
    await app.execute({
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "POLICY", policyKey: "refund" },
    }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});
test("sitemap descriptors bind even the first page to a version and never hydrate the catalogue", async () => {
  const { app, loadEntity } = await setup();
  const result = await app.execute({ schemaVersion: 1, operation: "CATALOG" });
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    kind: "STOREFRONT_SEO_CATALOG",
    shards: [{ itemCount: 1 }],
  });
  expect(loadEntity).not.toHaveBeenCalled();
  if (result.outcome !== "SUCCESS" || result.kind !== "STOREFRONT_SEO_CATALOG")
    return;
  expect(
    await app.execute({
      schemaVersion: 1,
      operation: "INDEX",
      cursor: result.shards[0]!.cursor,
    }),
  ).toMatchObject({ outcome: "SUCCESS" });
});
test("unknown input, cursor substitution and catalogue change never become empty success", async () => {
  const { app, run, readIndex } = await setup();
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX", market: "TEST" }),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX", cursor: "A" }),
  ).toMatchObject({ code: "INVALID_CURSOR" });
  expect(run).not.toHaveBeenCalled();
  const cursor = createStorefrontSeoCursor({
    schemaVersion: 1,
    operation: "INDEX",
    catalogVersion: "b".repeat(64),
    afterKey: null,
  });
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX", cursor }),
  ).toMatchObject({ code: "CATALOG_CHANGED" });
  readIndex.mockRejectedValue(new Error("private database error"));
  expect(await app.execute({ schemaVersion: 1, operation: "INDEX" })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});
test("duplicate, short continuing and wrong-identity index windows fail closed", async () => {
  const { app, readIndex, loadEntity } = await setup();
  for (const candidates of [
    [{ key: "3:privacy", locator: { kind: "POLICY", policyKey: "refund" } }],
    [
      { key: "3:privacy", locator: { kind: "POLICY", policyKey: "privacy" } },
      { key: "3:privacy", locator: { kind: "POLICY", policyKey: "privacy" } },
    ],
  ]) {
    readIndex.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "INDEX",
      catalogVersion: version,
      candidates,
      hasNextPage: false,
    } as never);
    expect(
      await app.execute({ schemaVersion: 1, operation: "INDEX" }),
    ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  }
  readIndex.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "INDEX",
    catalogVersion: version,
    candidates: [],
    hasNextPage: true,
  });
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX" }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  loadEntity.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  expect(
    await app.execute({
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "POLICY", policyKey: "privacy" },
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
});
test("catalogue traversal continues beyond 50 descriptors without hydration or duplicate shard cursors", async () => {
  const { app, readCatalog, loadEntity } = await setup();
  const key = (index: number) =>
    `1:82000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const rows = Array.from({ length: 51 }, (_, index) => ({
    firstKey: key(index * 20 + 1),
    lastKey: key(index * 20 + 20),
    afterKey: index === 0 ? null : key(index * 20),
    itemCount: 20,
  }));
  readCatalog.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "CATALOG",
    catalogVersion: version,
    boundaries: rows.slice(0, 50),
    hasNextPage: true,
  });
  const first = await app.execute({ schemaVersion: 1, operation: "CATALOG" });
  expect(first).toMatchObject({
    outcome: "SUCCESS",
    pageInfo: { hasNextPage: true },
  });
  if (first.outcome !== "SUCCESS" || first.kind !== "STOREFRONT_SEO_CATALOG")
    return;
  readCatalog.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "CATALOG",
    catalogVersion: version,
    boundaries: rows.slice(50),
    hasNextPage: false,
  });
  const last = await app.execute({
    schemaVersion: 1,
    operation: "CATALOG",
    cursor: first.pageInfo.endCursor,
  });
  expect(last).toMatchObject({
    outcome: "SUCCESS",
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  if (last.outcome !== "SUCCESS" || last.kind !== "STOREFRONT_SEO_CATALOG")
    return;
  expect(
    new Set([...first.shards, ...last.shards].map((row) => row.cursor)).size,
  ).toBe(51);
  expect(
    [...first.shards, ...last.shards].reduce(
      (total, row) => total + row.itemCount,
      0,
    ),
  ).toBe(1020);
  expect(loadEntity).not.toHaveBeenCalled();
});
test("enumerated missing proof, wrong locale, disordered or gapped descriptors fail as unavailable", async () => {
  const { app, loadEntity, readCatalog } = await setup();
  loadEntity.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX" }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  loadEntity.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: { ...storefrontSeoPolicyFixture(), locale: "ja" },
  });
  expect(
    await app.execute({ schemaVersion: 1, operation: "INDEX" }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  for (const boundaries of [
    [
      {
        firstKey: "3:privacy",
        lastKey: "3:refund",
        afterKey: "3:about",
        itemCount: 1,
      },
    ],
    [
      {
        firstKey: "3:privacy",
        lastKey: "3:about",
        afterKey: null,
        itemCount: 1,
      },
    ],
    [
      {
        firstKey: "3:about",
        lastKey: "3:privacy",
        afterKey: null,
        itemCount: 20,
      },
      {
        firstKey: "3:refund",
        lastKey: "3:refund",
        afterKey: "3:other",
        itemCount: 1,
      },
    ],
  ]) {
    readCatalog.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "CATALOG",
      catalogVersion: version,
      boundaries,
      hasNextPage: false,
    });
    expect(
      await app.execute({ schemaVersion: 1, operation: "CATALOG" }),
    ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  }
});
