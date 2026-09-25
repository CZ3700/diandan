import Fastify from "fastify";
import { expect, test, vi } from "vitest";
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
