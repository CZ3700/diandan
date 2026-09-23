import Fastify, { type FastifyInstance } from "fastify";
import { expect, test, vi } from "vitest";
import {
  giftDirectoryResponseSchema,
  idolDirectoryResponseSchema,
  publishedGiftCommerceResponseSchema,
  storefrontContextResponseSchema,
  storefrontGiftResponseSchema,
} from "@fan-support/contracts";
import { storefrontHomepageFixture } from "./storefront-homepage-fixtures.js";
import { registerStorefrontHomepageRoute } from "./storefront-homepage-route.js";
import { registerPublishedGiftCommerceRoute } from "./published-gift-commerce-route.js";
import { registerStorefrontCommerceRoute } from "./storefront-commerce-route.js";
import { registerCatalogDirectoryRoute } from "./catalog-directory-route.js";
import { registerPublishedContentRoute } from "./published-content-route.js";

const homepage = storefrontHomepageFixture();
const hero = homepage.slots[0];
if (hero?.status !== "AVAILABLE" || hero.content.content.kind !== "IDOL")
  throw new Error("Fictional published idol required");
const idol = hero.content.content.view;
const gift = publishedGiftCommerceResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLISHED_GIFT_COMMERCE",
  publication: homepage.homepage.publication,
  classification: { kind: "LEGACY" },
  content: {
    kind: "GIFT",
    view: {
      schemaVersion: 1,
      id: idol.id,
      handle: "fictional-gift",
      status: "active",
      localeContext: idol.localeContext,
      title: "Fictional gift",
      subtitle: "A thoughtful gesture",
      shortDescription: "Fictional description",
      description: "Fictional description",
      fulfillmentDescription: "Prepared for the selected artist",
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
      seoDescription: "Fictional description",
    },
    details: {
      format: "BLOCKS",
      blocks: [{ id: "intro", kind: "PARAGRAPH", text: "Reviewed detail" }],
    },
  },
});
if (gift.outcome !== "SUCCESS") throw new Error("Fictional gift required");
const commerceGift = storefrontGiftResponseSchema.parse({
  ...gift,
  kind: "STOREFRONT_GIFT",
  market: "TEST",
  currency: "USD",
  recipient: { kind: "NONE" },
  offers: [
    {
      giftVariantId: idol.id,
      price: { priceId: idol.id, priceRevision: 1, unitAmountMinor: 1000 },
      availability: "AVAILABLE",
      reason: null,
      requiresRecipient: true,
      stock: { kind: "PROCURE_ON_DEMAND" },
      maxQuantity: 10,
    },
  ],
});
const context = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [],
  policies: [],
});
const emptyIdols = idolDirectoryResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
});
const emptyGifts = giftDirectoryResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: {
    schemaVersion: 1,
    page: 1,
    pageSize: 12,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
    paginationLimited: false,
  },
});
type Reader = (input: unknown) => Promise<never>;
type Scenario = Readonly<{
  name: string;
  url: string;
  value: unknown;
  unavailable: string;
  register(app: FastifyInstance, read: Reader): void;
}>;
const scenarios: readonly Scenario[] = [
  {
    name: "homepage aggregate",
    url: "/api/v1/storefront-homepage?locale=en",
    value: homepage,
    unavailable: "CONTENT_UNAVAILABLE",
    register: (app, execute) =>
      registerStorefrontHomepageRoute(app, { useCases: { execute } }),
  },
  {
    name: "gift content",
    url: "/api/v1/gift-content/fictional-gift?locale=en",
    value: gift,
    unavailable: "CONTENT_UNAVAILABLE",
    register: (app, execute) =>
      registerPublishedGiftCommerceRoute(app, { useCases: { execute } }),
  },
  {
    name: "gift current offers",
    url: "/api/v1/storefront-gifts/fictional-gift?locale=en&market=TEST&currency=USD",
    value: commerceGift,
    unavailable: "CONTENT_UNAVAILABLE",
    register: (app, read) =>
      registerStorefrontCommerceRoute(app, {
        useCases: { readGift: read, readContext: read },
      }),
  },
  {
    name: "public configuration",
    url: "/api/v1/storefront-context",
    value: context,
    unavailable: "COMMERCE_UNAVAILABLE",
    register: (app, read) =>
      registerStorefrontCommerceRoute(app, {
        useCases: { readGift: read, readContext: read },
      }),
  },
  {
    name: "idol directory",
    url: "/api/v1/idols?locale=en",
    value: emptyIdols,
    unavailable: "CATALOG_UNAVAILABLE",
    register: (app, read) =>
      registerCatalogDirectoryRoute(app, { readIdols: read, readGifts: read }),
  },
  {
    name: "gift directory",
    url: "/api/v1/gifts?locale=en&market=TEST&currency=USD",
    value: emptyGifts,
    unavailable: "CATALOG_UNAVAILABLE",
    register: (app, read) =>
      registerCatalogDirectoryRoute(app, { readIdols: read, readGifts: read }),
  },
];

for (const scenario of scenarios) {
  test(`${scenario.name}: 304 follows a fresh validated read and cannot survive revoked proof`, async () => {
    const app = Fastify();
    const read = vi.fn<Reader>().mockResolvedValue(scenario.value as never);
    scenario.register(app, read);
    try {
      const first = await app.inject(scenario.url);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual(scenario.value);
      expect(first.headers["cache-control"]).toBe(
        "public, max-age=0, s-maxage=0, must-revalidate",
      );
      expect(first.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
      const headers = { "if-none-match": String(first.headers.etag) };
      const same = await app.inject({ url: scenario.url, headers });
      expect(same.statusCode).toBe(304);
      expect(same.body).toBe("");
      expect(same.headers.etag).toBe(first.headers.etag);
      expect(read).toHaveBeenCalledTimes(2);
      for (const invalid of [
        { schemaVersion: 1, outcome: "FAILURE", code: scenario.unavailable },
        { ...(scenario.value as object), privateCanary: "fixture-only" },
      ]) {
        read.mockResolvedValueOnce(invalid as never);
        const failed = await app.inject({ url: scenario.url, headers });
        expect(failed.statusCode).toBe(503);
        expect(failed.headers["cache-control"]).toBe("no-store");
        expect(failed.headers.etag).toBeUndefined();
        expect(failed.body).not.toContain("privateCanary");
      }
      read.mockRejectedValueOnce(new Error("fixture-only-private-data"));
      const thrown = await app.inject({ url: scenario.url, headers });
      expect(thrown.statusCode).toBe(503);
      expect(thrown.headers.etag).toBeUndefined();
      expect(thrown.body).not.toContain("fixture-only-private-data");
    } finally {
      await app.close();
    }
  });
  test(`${scenario.name}: credentials bypass shared revalidation for successes and failures`, async () => {
    const app = Fastify();
    const read = vi.fn<Reader>().mockResolvedValue(scenario.value as never);
    scenario.register(app, read);
    try {
      for (const credentials of [
        { cookie: "fixture=public" },
        { authorization: "Bearer fixture-only" },
      ]) {
        const headers = { ...credentials, "if-none-match": "*" };
        const success = await app.inject({ url: scenario.url, headers });
        expect(success.statusCode).toBe(200);
        expect(success.headers["cache-control"]).toBe("private, no-store");
        expect(success.headers.etag).toBeUndefined();
        expect(success.headers["set-cookie"]).toBeUndefined();
        read.mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: scenario.unavailable,
        } as never);
        const failed = await app.inject({ url: scenario.url, headers });
        expect(failed.statusCode).toBe(503);
        expect(failed.headers["cache-control"]).toBe("private, no-store");
        expect(failed.headers.etag).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
}

test("empty directory ETags partition canonical locale, search, market, currency and recipient query", async () => {
  const app = Fastify();
  registerCatalogDirectoryRoute(app, {
    readIdols: async () => emptyIdols,
    readGifts: async () => emptyGifts,
  });
  try {
    const tags = new Set<string>();
    for (const url of [
      "/api/v1/idols?locale=en",
      "/api/v1/idols?locale=ja",
      "/api/v1/idols?locale=en&q=artist",
      "/api/v1/idols?locale=en&limit=8",
      "/api/v1/gifts?locale=en&market=TEST&currency=USD",
      "/api/v1/gifts?locale=ja&market=TEST&currency=USD",
      "/api/v1/gifts?locale=en&market=OTHER&currency=USD",
      "/api/v1/gifts?locale=en&market=TEST&currency=JPY",
      `/api/v1/gifts?locale=en&market=TEST&currency=USD&idol=${idol.id}`,
    ]) {
      const response = await app.inject({
        url,
        headers: { "if-none-match": [...tags].join(", ") },
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
      expect(tags.has(String(response.headers.etag)), url).toBe(false);
      tags.add(String(response.headers.etag));
    }
    const canonical = await app.inject(
      "/api/v1/gifts?locale=en&market=TEST&currency=USD",
    );
    const reordered = await app.inject({
      url: "/api/v1/gifts?currency=USD&market=TEST&locale=en&page=1",
      headers: { "if-none-match": String(canonical.headers.etag) },
    });
    expect(reordered.statusCode).toBe(304);
  } finally {
    await app.close();
  }
});

test("directory scope is validated before ETag generation and conditional matching", async () => {
  const app = Fastify();
  const readIdols = vi
    .fn<Reader>()
    .mockResolvedValue({ ...emptyIdols, items: [idol] } as never);
  const readGifts = vi.fn<Reader>().mockResolvedValue({
    ...emptyGifts,
    items: [
      {
        schemaVersion: 1,
        gift: gift.content.view,
        offer: {
          schemaVersion: 1,
          market: "TEST",
          currency: "USD",
          priceMinor: 1000,
          purchasable: true,
        },
      },
    ],
    pageInfo: {
      schemaVersion: 1,
      page: 1,
      pageSize: 12,
      totalItems: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      paginationLimited: false,
    },
  } as never);
  registerCatalogDirectoryRoute(app, { readIdols, readGifts });
  try {
    for (const url of [
      "/api/v1/idols?locale=ja",
      "/api/v1/gifts?locale=ja&market=TEST&currency=USD",
      "/api/v1/gifts?locale=en&market=OTHER&currency=USD",
      "/api/v1/gifts?locale=en&market=TEST&currency=JPY",
      "/api/v1/gifts?locale=en&market=TEST&currency=USD&page=2",
    ]) {
      const reply = await app.inject({
        url,
        headers: { "if-none-match": "*" },
      });
      expect(reply.statusCode, url).toBe(503);
      expect(reply.headers.etag).toBeUndefined();
      expect(reply.headers["cache-control"]).toBe("no-store");
    }
  } finally {
    await app.close();
  }
});

test("gift price expiry changes the validated representation before an old ETag can match", async () => {
  if (commerceGift.outcome !== "SUCCESS")
    throw new Error("Fictional offer required");
  const app = Fastify();
  const read = vi.fn<Reader>().mockResolvedValue(commerceGift as never);
  registerStorefrontCommerceRoute(app, {
    useCases: { readGift: read, readContext: read },
  });
  try {
    const url =
      "/api/v1/storefront-gifts/fictional-gift?locale=en&market=TEST&currency=USD";
    const first = await app.inject(url);
    read.mockResolvedValueOnce(
      storefrontGiftResponseSchema.parse({
        ...commerceGift,
        offers: commerceGift.offers.map((offer) => ({
          ...offer,
          price: null,
          availability: "UNAVAILABLE",
          reason: "PRICE_UNAVAILABLE",
          maxQuantity: 0,
        })),
      }) as never,
    );
    const expired = await app.inject({
      url,
      headers: { "if-none-match": String(first.headers.etag) },
    });
    expect(expired.statusCode).toBe(200);
    expect(expired.headers.etag).not.toBe(first.headers.etag);
    expect(expired.json().offers[0]).toMatchObject({
      price: null,
      reason: "PRICE_UNAVAILABLE",
      maxQuantity: 0,
    });
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});

// These are transport DTO fixtures, not fabricated publication or approval evidence.
function withLocaleContexts(value: unknown, localeContext: object): unknown {
  if (Array.isArray(value))
    return value.map((item) => withLocaleContexts(item, localeContext));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "localeContext"
        ? localeContext
        : withLocaleContexts(entry, localeContext),
    ]),
  );
}
const originalLocale = {
  schemaVersion: 2,
  publicationMode: "DIRECT_OPERATOR_V1",
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  fallbackUsed: true,
  translationRevision: idol.id,
};
const populatedDirectories = {
  "idol directory": {
    ...emptyIdols,
    items: [idol],
  },
  "gift directory": {
    ...emptyGifts,
    items: [
      {
        schemaVersion: 1,
        gift: gift.content.view,
        offer: {
          schemaVersion: 1,
          market: "TEST",
          currency: "USD",
          priceMinor: 1000,
          purchasable: true,
        },
      },
    ],
    pageInfo: {
      schemaVersion: 1,
      page: 1,
      pageSize: 12,
      totalItems: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      paginationLimited: false,
    },
  },
};
const originalScenarios: readonly Scenario[] = [
  ...scenarios
    .filter((scenario) => scenario.name !== "public configuration")
    .map((scenario) => ({
      ...scenario,
      value:
        scenario.name === "idol directory"
          ? populatedDirectories["idol directory"]
          : scenario.name === "gift directory"
            ? populatedDirectories["gift directory"]
            : scenario.value,
    })),
  ...[
    ["published artist", "/idols/fictional-artist", hero.content],
    [
      "published gift",
      "/gifts/fictional-gift",
      { ...gift, kind: "PUBLISHED_CONTENT", classification: undefined },
    ],
    ["published homepage", "/homepage", homepage.homepage],
  ].map(([name, path, value]) => ({
    name: String(name),
    url: `/api/v1${String(path)}?locale=en`,
    value: JSON.parse(JSON.stringify(value)) as unknown,
    unavailable: "CONTENT_UNAVAILABLE",
    register: (app: FastifyInstance, execute: Reader) =>
      registerPublishedContentRoute(app, { useCases: { execute } }),
  })),
  {
    name: "gift selected original recipient",
    url: `/api/v1/storefront-gifts/fictional-gift?locale=en&market=TEST&currency=USD&idol=${idol.id}`,
    value:
      commerceGift.outcome === "SUCCESS"
        ? {
            ...commerceGift,
            recipient: {
              kind: "PUBLISHED",
              idol: {
                schemaVersion: 1,
                id: idol.id,
                handle: idol.handle,
                status: idol.status,
                acceptingGifts: idol.acceptingGifts,
                localeContext: idol.localeContext,
                displayName: idol.displayName,
                portrait: idol.portrait,
              },
            },
            offers: commerceGift.offers.map((offer) => ({
              ...offer,
              requiresRecipient: false,
            })),
          }
        : commerceGift,
    unavailable: "CONTENT_UNAVAILABLE",
    register: (app, read) =>
      registerStorefrontCommerceRoute(app, {
        useCases: { readContext: read, readGift: read },
      }),
  },
];
for (const scenario of originalScenarios) {
  test(`${scenario.name}: proven original locale passes while forged or mismatched provenance remains unavailable`, async () => {
    const app = Fastify();
    const read = vi.fn<Reader>();
    scenario.register(app, read);
    try {
      const value = withLocaleContexts(scenario.value, originalLocale);
      read.mockResolvedValue(value as never);
      const first = await app.inject(scenario.url);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual(value);
      const same = await app.inject({
        url: scenario.url,
        headers: { "if-none-match": String(first.headers.etag) },
      });
      expect(same.statusCode).toBe(304);
      expect(read).toHaveBeenCalledTimes(2);
      read.mockResolvedValueOnce(
        withLocaleContexts(scenario.value, {
          ...originalLocale,
          sourceLocale: "en",
          resolvedLocale: "en",
          fallbackUsed: false,
        }) as never,
      );
      expect((await app.inject(scenario.url)).statusCode).toBe(200);
      for (const invalid of [
        { ...originalLocale, sourceLocale: "ja" },
        { ...originalLocale, fallbackUsed: false },
        { ...originalLocale, requestedLocale: "ja" },
        { ...originalLocale, publicationMode: "UNKNOWN" },
        { ...originalLocale, translationRevision: undefined },
        {
          schemaVersion: 1,
          requestedLocale: "ja",
          resolvedLocale: "en",
          fallbackUsed: true,
          translationRevision: idol.id,
        },
      ]) {
        read.mockResolvedValueOnce(
          withLocaleContexts(scenario.value, invalid) as never,
        );
        const denied = await app.inject({
          url: scenario.url,
          headers: { "if-none-match": "*" },
        });
        expect(denied.statusCode).toBe(503);
        expect(denied.headers.etag).toBeUndefined();
        expect(denied.headers["cache-control"]).toBe("no-store");
      }
    } finally {
      await app.close();
    }
  });

  test(`${scenario.name}: validated English recovery revalidates by requested locale and still rejects invalid provenance`, async () => {
    const app = Fastify();
    const context = {
      schemaVersion: 1,
      requestedLocale: "ja",
      resolvedLocale: "en",
      fallbackUsed: true,
      translationRevision: idol.id,
    };
    const value = withLocaleContexts(scenario.value, context);
    const read = vi.fn<Reader>().mockResolvedValue(value as never);
    scenario.register(app, read);
    const url = scenario.url.replace("locale=en", "locale=ja");
    try {
      const first = await app.inject(url);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual(value);
      expect(first.headers.etag).toEqual(expect.any(String));
      const same = await app.inject({
        url,
        headers: { "if-none-match": String(first.headers.etag) },
      });
      expect(same.statusCode).toBe(304);
      expect(read).toHaveBeenCalledTimes(2);

      read.mockResolvedValueOnce(
        withLocaleContexts(scenario.value, {
          ...context,
          resolvedLocale: "ja",
          fallbackUsed: false,
        }) as never,
      );
      const restored = await app.inject({
        url,
        headers: { "if-none-match": String(first.headers.etag) },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.headers.etag).not.toBe(first.headers.etag);

      for (const invalid of [
        { ...context, requestedLocale: "en" },
        { ...context, resolvedLocale: "zh-CN" },
        { ...context, fallbackUsed: false },
        { ...context, translationRevision: "" },
        { ...context, schemaVersion: 999 },
      ]) {
        read.mockResolvedValueOnce(
          withLocaleContexts(scenario.value, invalid) as never,
        );
        const denied = await app.inject({
          url,
          headers: { "if-none-match": "*" },
        });
        expect(denied.statusCode).toBe(503);
        expect(denied.headers.etag).toBeUndefined();
        expect(denied.headers["cache-control"]).toBe("no-store");
      }
    } finally {
      await app.close();
    }
  });
}
