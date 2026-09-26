import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerGiftBrowseRoute } from "./gift-browse-route.js";
import {
  publishedGiftViewSchema,
  type GiftBrowseResponse,
} from "@fan-support/contracts";
import { storefrontHomepageFixture } from "./test-support/storefront-homepage-fixtures.js";

const empty = {
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

test("serves context-free gift browsing with fresh anonymous revalidation and private credential requests", async () => {
  const app = Fastify();
  const browseGifts = vi.fn(async () => empty);
  registerGiftBrowseRoute(app, { browseGifts });
  try {
    const url =
      "/api/v1/gift-browse?locale=th&category=OTHER&idol=10000000-0000-4000-8000-000000000001";
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(browseGifts).toHaveBeenCalledWith({
      schemaVersion: 1,
      locale: "th",
      category: "OTHER",
      idolId: "10000000-0000-4000-8000-000000000001",
      page: 1,
      pageSize: 12,
    });
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    const repeated = await app.inject({
      url,
      headers: { "if-none-match": response.headers.etag! },
    });
    expect(repeated.statusCode).toBe(304);
    expect(repeated.body).toBe("");
    expect(browseGifts).toHaveBeenCalledTimes(2);
    for (const headers of [
      { cookie: "viewer=test" },
      { authorization: "Bearer test" },
    ]) {
      const privateResponse = await app.inject({ url, headers });
      expect(privateResponse.statusCode).toBe(200);
      expect(privateResponse.headers["cache-control"]).toBe(
        "private, no-store",
      );
      expect(privateResponse.headers.etag).toBeUndefined();
    }
    expect(response.body).not.toMatch(/market|currency|offer|price/u);
  } finally {
    await app.close();
  }
});

test("rejects duplicate, unknown, commerce and noncanonical parameters before the application", async () => {
  const app = Fastify();
  const browseGifts = vi.fn(async () => empty);
  registerGiftBrowseRoute(app, { browseGifts });
  try {
    for (const query of [
      "",
      "locale=xx",
      "locale=en&locale=ja",
      "locale=en&market=TEST",
      "locale=en&currency=USD",
      "locale=en&sort=PRICE_ASC",
      "locale=en&schemaVersion=1",
      "locale=en&page=01",
      "locale=en&page=1e2",
      "locale=en&page=1001",
      "locale=en&pageSize=49",
      "locale=en&page=1&page=2",
      "locale=en&idolId=10000000-0000-4000-8000-000000000001",
    ]) {
      const response = await app.inject({
        url: `/api/v1/gift-browse?${query}`,
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers.etag).toBeUndefined();
    }
    expect(browseGifts).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("contains malformed output, page substitution and application exceptions without stale cache responses", async () => {
  const app = Fastify();
  const browseGifts = vi.fn(async () => empty);
  registerGiftBrowseRoute(app, { browseGifts });
  try {
    browseGifts.mockResolvedValueOnce({
      ...empty,
      market: "TEST",
    } as typeof empty);
    browseGifts.mockResolvedValueOnce({
      ...empty,
      pageInfo: { ...empty.pageInfo, page: 2, hasPreviousPage: true },
    });
    browseGifts.mockRejectedValueOnce(new Error("private database detail"));
    for (let index = 0; index < 3; index++) {
      const response = await app.inject({
        url: "/api/v1/gift-browse?locale=en",
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CATALOG_UNAVAILABLE",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers.etag).toBeUndefined();
    }
  } finally {
    await app.close();
  }
});

test("serves proven fallback content while rejecting missing provenance, wrong locale and category substitution", async () => {
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
      requestedLocale: "th",
      resolvedLocale: "en",
      fallbackUsed: true,
      translationRevision: idol.id,
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
  const response: GiftBrowseResponse = {
    ...empty,
    items: [gift],
    pageInfo: { ...empty.pageInfo, totalItems: 1, totalPages: 1 },
  };
  const browseGifts = vi.fn(async (): Promise<GiftBrowseResponse> => response);
  const app = Fastify();
  registerGiftBrowseRoute(app, { browseGifts });
  try {
    expect(
      (await app.inject({ url: "/api/v1/gift-browse?locale=th" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/gift-browse?locale=ja" })).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          url: "/api/v1/gift-browse?locale=th&category=FLOWERS",
        })
      ).statusCode,
    ).toBe(503);
    for (const [giftKind, status] of [
      ["VIRTUAL", 200],
      ["PHYSICAL", 503],
      [null, 503],
      [undefined, 503],
    ] as const) {
      browseGifts.mockResolvedValueOnce({
        ...response,
        items: [giftKind === undefined ? gift : { ...gift, giftKind }],
      });
      expect(
        (
          await app.inject({
            url: "/api/v1/gift-browse?locale=th&kind=VIRTUAL",
          })
        ).statusCode,
        String(giftKind),
      ).toBe(status);
    }
    expect(browseGifts).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "VIRTUAL" }),
    );
    expect(
      (await app.inject({ url: "/api/v1/gift-browse?locale=th&kind=TIP" }))
        .statusCode,
    ).toBe(400);
    browseGifts.mockResolvedValueOnce({
      ...response,
      items: [
        {
          ...gift,
          localeContext: {
            schemaVersion: 1,
            requestedLocale: "th",
            resolvedLocale: "en",
            fallbackUsed: true,
          },
        },
      ],
    });
    expect(
      (await app.inject({ url: "/api/v1/gift-browse?locale=th" })).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});
