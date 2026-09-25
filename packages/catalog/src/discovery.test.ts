import { expect, test } from "vitest";

import {
  createGiftDiscoveryPlan,
  createIdolDiscoveryPlan,
  changeGiftDiscoveryQuery,
  createCatalogPageInfo,
} from "./index.js";

const context = {
  schemaVersion: 1,
  locale: "zh-CN",
  market: "TEST-MARKET",
  currency: "USD",
};

test("server query plans bound work and use a unique stable key after the price", () => {
  const descending = createGiftDiscoveryPlan({
    ...context,
    page: 3,
    sort: "PRICE_DESC",
  });
  expect(descending.offset).toBe(24);
  expect(descending.take).toBe(12);
  expect(descending.orderBy).toEqual([
    { field: "PRICE_MINOR", direction: "DESC", nulls: "LAST" },
    { field: "ID", direction: "ASC" },
  ]);
  expect(
    createGiftDiscoveryPlan({ ...context, sort: "PRICE_ASC" }).orderBy[0],
  ).toEqual({ field: "PRICE_MINOR", direction: "ASC", nulls: "LAST" });
  expect(createGiftDiscoveryPlan(context).orderBy[0]).toEqual({
    field: "PUBLISHED_AT",
    direction: "DESC",
  });
  expect(() => createGiftDiscoveryPlan({ ...context, page: 1001 })).toThrow();
  expect(JSON.parse(JSON.stringify(descending))).toEqual(descending);
});

test("a filter or sorting change resets the page while locale-only navigation preserves commerce", () => {
  const query = { ...context, page: 8, category: "FLOWERS", priceMinMinor: 10 };
  expect(
    changeGiftDiscoveryQuery({
      schemaVersion: 1,
      query,
      changes: { sort: "PRICE_DESC", page: 6 },
    }),
  ).toMatchObject({
    page: 1,
    category: "FLOWERS",
    market: context.market,
    currency: context.currency,
  });
  expect(
    changeGiftDiscoveryQuery({
      schemaVersion: 1,
      query,
      changes: { locale: "th" },
    }),
  ).toMatchObject({
    page: 8,
    category: "FLOWERS",
    locale: "th",
    market: context.market,
    currency: context.currency,
  });
  const cleared = changeGiftDiscoveryQuery({
    schemaVersion: 1,
    query,
    changes: { category: null, priceMinMinor: null },
  });
  expect(cleared).toMatchObject({ page: 1 });
  expect(cleared).not.toHaveProperty("category");
  expect(cleared).not.toHaveProperty("priceMinMinor");
  expect(
    changeGiftDiscoveryQuery({
      schemaVersion: 1,
      query,
      changes: { category: "FLOWERS" },
    }).page,
  ).toBe(8);
  expect(() =>
    changeGiftDiscoveryQuery({
      schemaVersion: 1,
      query,
      changes: { currency: "EUR" },
    }),
  ).toThrow();
  expect(() =>
    changeGiftDiscoveryQuery({
      schemaVersion: 1,
      query,
      changes: { priceMaxMinor: 5 },
    }),
  ).toThrow();
});

test("artist search normalizes a projection, preserves accents and directly carries the anchor", () => {
  const query = { schemaVersion: 1, locale: "vi", q: "Mỹ ＡＮＨ", limit: 12 };
  const plan = createIdolDiscoveryPlan(query);
  expect(plan.searchTerm).toBe("mỹ anh");
  expect(query.q).toBe("Mỹ ＡＮＨ");
  expect(plan.take).toBe(13);
  expect(plan.orderBy).toEqual([
    { field: "MATCH_RANK", direction: "ASC" },
    { field: "DISPLAY_ORDER", direction: "ASC" },
    { field: "ID", direction: "ASC" },
  ]);
  const anchorId = "b74152dc-e245-44d5-97f5-ff84ef60e138";
  expect(
    createIdolDiscoveryPlan({ schemaVersion: 1, locale: "th", anchorId }).query
      .anchorId,
  ).toBe(anchorId);
  expect(
    createIdolDiscoveryPlan({ schemaVersion: 1, locale: "th", q: "น้ำ" })
      .searchTerm,
  ).toBe("น้ำ");
  expect(
    createIdolDiscoveryPlan({ schemaVersion: 1, locale: "zh-CN", q: "林明" })
      .searchTerm,
  ).toBe("林明");
});

test("page metadata shows the actual requested page and does not silently jump after catalog changes", () => {
  expect(
    createCatalogPageInfo({
      schemaVersion: 1,
      page: 4,
      pageSize: 12,
      totalItems: 25,
    }),
  ).toEqual({
    schemaVersion: 1,
    page: 4,
    pageSize: 12,
    totalItems: 25,
    totalPages: 3,
    hasPreviousPage: true,
    hasNextPage: false,
    paginationLimited: false,
  });
  expect(
    createCatalogPageInfo({
      schemaVersion: 1,
      page: 1,
      pageSize: 12,
      totalItems: 0,
    }),
  ).toMatchObject({
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
  });
});

test("accepted artist queries remain valid when normalization or case folding expands characters", () => {
  expect(
    createIdolDiscoveryPlan({
      schemaVersion: 1,
      locale: "en",
      q: "İ".repeat(80),
    }).searchTerm,
  ).toBe("i\u0307".repeat(80));
  for (const character of ["\uFB2C", "\u{1D160}"]) {
    const q = character.repeat(80);
    expect(
      createIdolDiscoveryPlan({ schemaVersion: 1, locale: "en", q }).searchTerm,
    ).toBe(q.normalize("NFC").toLowerCase());
  }
});

test("page limits never offer an invalid next page and expose a filter refinement condition", () => {
  expect(
    createCatalogPageInfo({
      schemaVersion: 1,
      page: 1000,
      pageSize: 1,
      totalItems: 1001,
    }),
  ).toMatchObject({
    hasNextPage: false,
    paginationLimited: true,
    totalPages: 1001,
  });
});
