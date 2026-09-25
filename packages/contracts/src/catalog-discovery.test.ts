import { expect, test } from "vitest";

async function schema(name: string) {
  const exports: Record<string, unknown> = await import("./index.js");
  expect(exports[name], name).toBeDefined();
  return exports[name] as { safeParse(value: unknown): { success: boolean } };
}

const context = { schemaVersion: 1, locale: "zh-CN" };
const commercial = { ...context, market: "TEST-MARKET", currency: "USD" };

test("artist discovery requires a canonical locale and bounds incremental windows", async () => {
  const contract = await schema("idolDiscoveryQuerySchema");
  expect(contract.safeParse({ ...context, q: "林明", limit: 12 }).success).toBe(
    true,
  );
  for (const invalid of [
    { ...context, locale: "en-XA" },
    { ...context, limit: 41 },
    { ...context, limit: 0 },
    { ...context, q: "x".repeat(81) },
    { ...context, q: "  Name  " },
    {
      ...context,
      after: "opaque",
      anchorId: "b74152dc-e245-44d5-97f5-ff84ef60e138",
    },
    { ...context, schemaVersion: 2 },
    { ...context, currency: "USD" },
  ])
    expect(contract.safeParse(invalid).success).toBe(false);
});

test("gift discovery separates currency from locale and rejects unsafe pagination/prices", async () => {
  const contract = await schema("giftDiscoveryQuerySchema");
  expect(
    contract.safeParse({
      ...commercial,
      page: 2,
      sort: "PRICE_DESC",
      priceMinMinor: 0,
      priceMaxMinor: 999,
    }).success,
  ).toBe(true);
  for (const invalid of [
    context,
    { ...commercial, currency: "usd" },
    { ...commercial, page: 0 },
    { ...commercial, page: 1001 },
    { ...commercial, pageSize: 49 },
    { ...commercial, page: 1.5 },
    { ...commercial, priceMinMinor: -1 },
    { ...commercial, priceMaxMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...commercial, priceMinMinor: 20, priceMaxMinor: 10 },
    { ...commercial, sort: "RANDOM()" },
    { ...commercial, locale: "pt-BR" },
  ])
    expect(contract.safeParse(invalid).success).toBe(false);
});

test("pagination metadata is internally consistent, including an out-of-range empty page", async () => {
  const contract = await schema("catalogPageInfoSchema");
  const page = {
    schemaVersion: 1,
    page: 3,
    pageSize: 12,
    totalItems: 25,
    totalPages: 3,
    hasPreviousPage: true,
    hasNextPage: false,
    paginationLimited: false,
  };
  expect(contract.safeParse(page).success).toBe(true);
  expect(contract.safeParse({ ...page, totalPages: 2 }).success).toBe(false);
  expect(contract.safeParse({ ...page, hasNextPage: true }).success).toBe(
    false,
  );
  expect(contract.safeParse({ ...page, page: 4 }).success).toBe(true);
  expect(
    contract.safeParse({
      ...page,
      page: 1,
      totalItems: 0,
      totalPages: 0,
      hasPreviousPage: false,
    }).success,
  ).toBe(true);
});
