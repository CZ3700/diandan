import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { storefrontGiftResponseSchema } from "@fan-support/contracts";
import { storefrontHomepageFixture } from "./test-support/storefront-homepage-fixtures.js";
const notFound = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "NOT_FOUND",
} as const;
async function setup() {
  const { registerStorefrontCommerceRoute } =
    await import("./storefront-commerce-route.js");
  const app = Fastify({ logger: false });
  const readGift = vi.fn<(input: unknown) => Promise<unknown>>(
    async () => notFound,
  );
  const readContext = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: [],
    policies: [],
  }));
  registerStorefrontCommerceRoute(app, {
    useCases: { readGift, readContext },
  } as never);
  return { app, readGift, readContext };
}
test("commerce route requires explicit canonical locale and scope, rejects duplicate or unknown parameters", async () => {
  const { app, readGift, readContext } = await setup();
  try {
    for (const query of [
      "",
      "?locale=en",
      "?locale=en&market=TEST&currency=USD&locale=ja",
      "?locale=en&market=TEST&currency=USD&private=yes",
      "?locale=en-XA&market=TEST&currency=USD",
    ])
      expect(
        (await app.inject(`/api/v1/storefront-gifts/gift${query}`)).statusCode,
      ).toBe(400);
    expect(readGift).not.toHaveBeenCalled();
    expect(
      (await app.inject("/api/v1/storefront-context?locale=en")).statusCode,
    ).toBe(400);
    expect(readContext).not.toHaveBeenCalled();
    expect((await app.inject("/api/v1/storefront-context")).statusCode).toBe(
      200,
    );
    const result = await app.inject(
      "/api/v1/storefront-gifts/gift?locale=ja&market=TEST&currency=USD",
    );
    expect(result.statusCode).toBe(404);
    expect(readGift).toHaveBeenCalledWith({
      schemaVersion: 1,
      handle: "gift",
      locale: "ja",
      market: "TEST",
      currency: "USD",
    });
    expect(result.headers).toMatchObject({
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
  } finally {
    await app.close();
  }
});
test("commerce errors retain typed status without disclosing unexpected database values", async () => {
  const { app, readGift, readContext } = await setup();
  try {
    readGift.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "MARKET_UNAVAILABLE",
    });
    expect(
      (
        await app.inject(
          "/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD",
        )
      ).statusCode,
    ).toBe(409);
    for (const value of [
      { internalSku: "private" },
      { ...notFound, privateAddress: "private" },
    ]) {
      readGift.mockResolvedValueOnce(value);
      const reply = await app.inject(
        "/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD",
      );
      expect(reply.statusCode).toBe(503);
      expect(reply.body).not.toContain("private");
    }
    readContext.mockRejectedValueOnce(new Error("private database details"));
    expect((await app.inject("/api/v1/storefront-context")).json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "COMMERCE_UNAVAILABLE",
    });
  } finally {
    await app.close();
  }
});

function boundWish() {
  const homepage = storefrontHomepageFixture();
  const hero = homepage.slots[0];
  if (hero?.status !== "AVAILABLE" || hero.content.content.kind !== "IDOL")
    throw new Error("Published fixture artist required");
  const artist = hero.content.content.view;
  const result = storefrontGiftResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_GIFT",
    publication: homepage.homepage.publication,
    classification: {
      kind: "CLASSIFIED",
      giftKind: "WISH",
      profileHash: "a".repeat(64),
    },
    content: {
      kind: "GIFT",
      view: {
        schemaVersion: 1,
        id: artist.id,
        handle: "gift",
        status: "active",
        localeContext: artist.localeContext,
        title: "A wish",
        shortDescription: "A wish",
        description: "A wish",
        category: "OTHER",
        contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
        shippingMode: "internal_to_idol",
        fulfillmentDescription: "Prepared for the artist",
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        primaryMedia: artist.portrait,
        gallery: [],
        seoTitle: "A wish",
        seoDescription: "A wish",
        variants: [
          {
            schemaVersion: 1,
            id: artist.id,
            label: "One wish",
            status: "active",
            inventoryPolicy: "TRACKED",
          },
        ],
        wish: {
          schemaVersion: 1,
          wishId: artist.id,
          artistId: artist.id,
          artistName: artist.displayName,
          artistHandle: artist.handle,
          status: "AVAILABLE",
        },
      },
      details: { format: "LEGACY_TEXT", text: "A wish" },
    },
    market: "TEST",
    currency: "USD",
    recipient: {
      kind: "PUBLISHED",
      idol: {
        schemaVersion: artist.schemaVersion,
        id: artist.id,
        handle: artist.handle,
        status: artist.status,
        acceptingGifts: artist.acceptingGifts,
        localeContext: artist.localeContext,
        displayName: artist.displayName,
        portrait: artist.portrait,
      },
    },
    offers: [
      {
        giftVariantId: artist.id,
        price: { priceId: artist.id, priceRevision: 1, unitAmountMinor: 1000 },
        availability: "AVAILABLE",
        reason: null,
        requiresRecipient: false,
        stock: { kind: "TRACKED", availableQuantity: 1 },
        maxQuantity: 1,
      },
    ],
  });
  if (result.outcome !== "SUCCESS")
    throw new Error("Successful wish fixture required");
  return result;
}

test("classified wish reads bind the published recipient independently of a missing or different query recipient", async () => {
  const { app, readGift } = await setup();
  const wish = boundWish();
  readGift.mockResolvedValue(wish);
  try {
    for (const idol of [
      undefined,
      wish.content.view.wish!.artistId,
      "abcdefab-0000-4000-8000-000000000002",
    ]) {
      const response = await app.inject(
        `/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD${idol === undefined ? "" : `&idol=${idol}`}`,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().recipient).toEqual(wish.recipient);
    }
  } finally {
    await app.close();
  }
});

test("ordinary gifts keep query recipient checks and wishes reject a response for any other recipient", async () => {
  const { app, readGift } = await setup();
  const wish = boundWish();
  const otherId = "abcdefab-0000-4000-8000-000000000002";
  try {
    for (const classification of [
      { kind: "LEGACY" },
      { kind: "CLASSIFIED", giftKind: "PHYSICAL", profileHash: "a".repeat(64) },
    ]) {
      readGift.mockResolvedValue({ ...wish, classification });
      expect(
        (
          await app.inject(
            "/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD",
          )
        ).statusCode,
      ).toBe(503);
      expect(
        (
          await app.inject(
            `/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD&idol=${otherId}`,
          )
        ).statusCode,
      ).toBe(503);
    }
    readGift.mockResolvedValue({
      ...wish,
      recipient: { kind: "UNAVAILABLE", idolId: otherId },
      offers: wish.offers.map((offer) => ({
        ...offer,
        availability: "UNAVAILABLE",
        reason: "RECIPIENT_UNAVAILABLE",
        maxQuantity: 0,
      })),
    });
    expect(
      (
        await app.inject(
          `/api/v1/storefront-gifts/gift?locale=en&market=TEST&currency=USD&idol=${otherId}`,
        )
      ).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});
