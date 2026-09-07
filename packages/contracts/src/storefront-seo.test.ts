import { expect, test } from "vitest";

test("SEO exposes separate strict entity, bounded index and lightweight sitemap descriptor commands", async () => {
  const seo = await import("./storefront-seo.js").catch(() => undefined);
  expect(seo, "the independent SEO contract must exist").toBeDefined();
  if (!seo) return;
  for (const operation of ["INDEX", "CATALOG"])
    expect(
      seo.storefrontSeoReadCommandSchema.safeParse({
        schemaVersion: 1,
        operation,
      }).success,
    ).toBe(true);
  expect(
    seo.storefrontSeoReadCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "HOMEPAGE" },
    }).success,
  ).toBe(true);
  for (const input of [
    { schemaVersion: 1, operation: "INDEX", market: "TEST" },
    { schemaVersion: 1, operation: "INDEX", locale: "en" },
    { schemaVersion: 1, operation: "INDEX", cursor: "=" },
    { schemaVersion: 1, operation: "CATALOG", limit: 1000000 },
    {
      schemaVersion: 1,
      operation: "ENTITY",
      locator: {
        kind: "MEDIA_METADATA",
        mediaAssetId: "00000000-0000-4000-8000-000000000001",
      },
    },
    {
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "IDOL", handle: "../secret" },
    },
  ])
    expect(seo.storefrontSeoReadCommandSchema.safeParse(input).success).toBe(
      false,
    );
});

test("SEO DTO permits an ordered proven locale subset without inventing approval and rejects duplicate or foreign rows", async () => {
  const seo = await import("./storefront-seo.js");
  const at = "2026-09-07T00:00:00.000Z";
  const row = {
    schemaVersion: 1,
    locator: { kind: "HOMEPAGE" },
    publication: {
      id: "00000000-0000-4000-8000-000000000001",
      revisionId: "00000000-0000-4000-8000-000000000002",
      manifestHash: "a".repeat(64),
      publishedAt: at,
    },
    locales: [
      {
        locale: "en",
        translationRevision: "00000000-0000-4000-8000-000000000003",
        lastModified: at,
      },
    ],
  };
  expect(seo.storefrontSeoEntitySchema.safeParse(row).success).toBe(true);
  for (const locales of [
    [],
    [...row.locales, ...row.locales],
    [{ ...row.locales[0], locale: "en-XA" }],
    [{ ...row.locales[0], lastModified: "2026-09-08T00:00:00.000Z" }],
    [
      { ...row.locales[0], locale: "ja" },
      {
        ...row.locales[0],
        translationRevision: "00000000-0000-4000-8000-000000000004",
      },
    ],
  ])
    expect(
      seo.storefrontSeoEntitySchema.safeParse({ ...row, locales }).success,
    ).toBe(false);
});
