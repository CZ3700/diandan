import Fastify from "fastify";
import { expect, test, vi } from "vitest";

import { publishedGiftViewSchema } from "@fan-support/contracts";
import { registerCatalogDirectoryRoute } from "./catalog-directory-route.js";
import { storefrontHomepageFixture } from "./test-support/storefront-homepage-fixtures.js";

const emptyIdols = {
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: { schemaVersion: 1 as const, hasNextPage: false, endCursor: null },
};
const emptyGifts = {
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: {
    schemaVersion: 1 as const,
    page: 1,
    pageSize: 12,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
    paginationLimited: false,
  },
};

test("parses explicit public directory context and revalidates successful public reads", async () => {
  const app = Fastify();
  const readIdols = vi.fn(async () => emptyIdols);
  const readGifts = vi.fn(async () => emptyGifts);
  registerCatalogDirectoryRoute(app, {
    readIdols,
    readGifts,
    browseGifts: async () => emptyGifts,
  });
  try {
    const idols = await app.inject({
      url: "/api/v1/idols?locale=ja&q=%E3%83%9F%E3%83%A9&limit=8",
    });
    expect(idols.statusCode).toBe(200);
    expect(idols.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    expect(idols.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    expect(readIdols).toHaveBeenCalledWith({
      schemaVersion: 1,
      locale: "ja",
      q: "ミラ",
      limit: 8,
    });
    const gifts = await app.inject({
      url: "/api/v1/gifts?locale=th&market=TEST&currency=USD&page=1&priceMinMinor=0",
    });
    expect(gifts.statusCode).toBe(200);
    expect(readGifts).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "th",
        market: "TEST",
        currency: "USD",
        page: 1,
        priceMinMinor: 0,
      }),
    );
  } finally {
    await app.close();
  }
});

test("rejects duplicate, unknown, missing and noncanonical numeric parameters before application calls", async () => {
  const app = Fastify();
  const readIdols = vi.fn(async () => emptyIdols);
  const readGifts = vi.fn(async () => emptyGifts);
  registerCatalogDirectoryRoute(app, {
    readIdols,
    readGifts,
    browseGifts: async () => emptyGifts,
  });
  try {
    const urls = [
      "/api/v1/idols?locale=en&locale=ja",
      "/api/v1/idols?locale=en&limit=1&limit=2",
      "/api/v1/idols?locale=en&schemaVersion=1",
      "/api/v1/idols?locale=en&unexpected=true",
      "/api/v1/idols?locale=en&limit=01",
      "/api/v1/idols?locale=en&limit=1e1",
      "/api/v1/idols?locale=en&limit=1.0",
      "/api/v1/idols?locale=en&limit=+1",
      "/api/v1/idols?locale=en&limit=",
      "/api/v1/idols?locale=xx",
      "/api/v1/idols",
      "/api/v1/gifts?locale=en&market=TEST",
      "/api/v1/gifts?locale=en&market=TEST&currency=USD&page=1001",
    ];
    for (const url of urls) {
      const response = await app.inject({ url });
      expect(response.statusCode, url).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(readIdols).not.toHaveBeenCalled();
    expect(readGifts).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("returns stable navigation failure codes and contains application exceptions", async () => {
  const app = Fastify();
  const readIdols = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "CATALOG_CHANGED" as const,
  }));
  const readGifts = vi.fn(async () => {
    throw new Error("private source data");
  });
  registerCatalogDirectoryRoute(app, {
    readIdols,
    readGifts,
    browseGifts: async () => emptyGifts,
  });
  try {
    const changed = await app.inject({ url: "/api/v1/idols?locale=en" });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_CHANGED",
    });
    const unavailable = await app.inject({
      url: "/api/v1/gifts?locale=en&market=TEST&currency=USD",
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("private source data");
  } finally {
    await app.close();
  }
});

test("maps all declared directory failures and rejects malformed application output", async () => {
  const cases = [
    ["INVALID_QUERY", 400],
    ["INVALID_CURSOR", 400],
    ["ANCHOR_NOT_FOUND", 404],
    ["CATALOG_CHANGED", 409],
    ["CATALOG_UNAVAILABLE", 503],
  ] as const;
  let code: (typeof cases)[number][0] = "INVALID_QUERY";
  const app = Fastify();
  registerCatalogDirectoryRoute(app, {
    readIdols: async () => ({ schemaVersion: 1, outcome: "FAILURE", code }),
    browseGifts: async () => emptyGifts,
    readGifts: async () =>
      ({ ...emptyGifts, internalSecret: "fixture-private-canary" }) as never,
  });
  try {
    for (const [next, status] of cases) {
      code = next;
      const response = await app.inject({ url: "/api/v1/idols?locale=en" });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
    }
    const invalid = await app.inject({
      url: "/api/v1/gifts?locale=en&market=TEST&currency=USD",
    });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.body).not.toContain("fixture-private-canary");
  } finally {
    await app.close();
  }
});

test("passes a gift kind through and rejects a priced page that substitutes another kind", async () => {
  const hero = storefrontHomepageFixture().slots[0];
  if (hero?.status !== "AVAILABLE" || hero.content.content.kind !== "IDOL")
    throw new Error("Expected fictional artist");
  const idol = hero.content.content.view;
  const gift = publishedGiftViewSchema.parse({
    schemaVersion: 1,
    id: idol.id,
    handle: "fictional-gift",
    status: "active",
    localeContext: {
      schemaVersion: 1,
      requestedLocale: "en",
      resolvedLocale: "en",
      fallbackUsed: false,
    },
    title: "Fictional gift",
    shortDescription: "A fictional gift",
    description: "A fictional gift",
    fulfillmentDescription: "Prepared by the studio",
    category: "OTHER",
    contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
    deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
    shippingMode: "internal_to_idol",
    primaryMedia: idol.portrait,
    gallery: [],
    variants: [
      {
        schemaVersion: 1,
        id: idol.id,
        label: "Standard",
        status: "active",
        inventoryPolicy: "PROCURE_ON_DEMAND",
      },
    ],
    seoTitle: "Fictional gift",
    seoDescription: "A fictional gift",
  });
  const page = (giftKind: "WISH" | "PHYSICAL" | null) => ({
    ...emptyGifts,
    items: [
      {
        schemaVersion: 1 as const,
        gift: { ...gift, giftKind },
        offer: {
          schemaVersion: 1 as const,
          market: "TEST",
          currency: "USD",
          priceMinor: 500,
          purchasable: true,
        },
      },
    ],
    pageInfo: { ...emptyGifts.pageInfo, totalItems: 1, totalPages: 1 },
  });
  const readGifts = vi.fn(async () => page("WISH") as never);
  const app = Fastify();
  registerCatalogDirectoryRoute(app, {
    readIdols: async () => emptyIdols,
    readGifts,
    browseGifts: async () => emptyGifts,
  });
  try {
    const url = "/api/v1/gifts?locale=en&market=TEST&currency=USD&kind=WISH";
    expect((await app.inject({ url })).statusCode).toBe(200);
    expect(readGifts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "WISH" }),
    );
    for (const other of ["PHYSICAL", null] as const) {
      readGifts.mockResolvedValueOnce(page(other) as never);
      expect((await app.inject({ url })).statusCode, String(other)).toBe(503);
    }
    readGifts.mockClear();
    expect(
      (
        await app.inject({
          url: "/api/v1/gifts?locale=en&market=TEST&currency=USD&kind=tip",
        })
      ).statusCode,
    ).toBe(400);
    expect(readGifts).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
