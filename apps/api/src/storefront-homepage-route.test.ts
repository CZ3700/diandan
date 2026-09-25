import * as homepageModule from "./storefront-homepage-route.js";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import type { StorefrontHomepageRouteDependencies } from "./storefront-homepage-route.js";
import { storefrontHomepageFixture } from "./storefront-homepage-fixtures.js";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

async function setup() {
  const app = Fastify({ logger: false });
  const execute = vi.fn<
    StorefrontHomepageRouteDependencies["useCases"]["execute"]
  >(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }));
  homepageModule.registerStorefrontHomepageRoute(app, {
    useCases: { execute },
  });
  return { app, execute };
}
test("only one explicit canonical locale reaches homepage application", async () => {
  const { app, execute } = await setup();
  try {
    for (const suffix of [
      "",
      "?locale=en&locale=ja",
      "?locale=en&giftId=caller",
      "?locale=en-XA",
      "?locale=EN",
      "?q=test",
    ])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/storefront-homepage${suffix}`,
          })
        ).statusCode,
      ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    const reply = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-homepage?locale=ja",
    });
    expect(reply.statusCode).toBe(404);
    expect(execute).toHaveBeenCalledWith({ schemaVersion: 1, locale: "ja" });
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers["x-robots-tag"]).toBe("noindex, nofollow");
  } finally {
    await app.close();
  }
});
test("unexpected response or thrown database error never leaks", async () => {
  const { app, execute } = await setup();
  try {
    execute.mockResolvedValue({
      privateSource: "private database data",
    } as never);
    let reply = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-homepage?locale=en",
    });
    expect(reply.statusCode).toBe(503);
    expect(reply.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    execute.mockRejectedValue(new Error("private database data"));
    reply = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-homepage?locale=en",
    });
    expect(reply.statusCode).toBe(503);
    expect(reply.body).not.toContain("private database");
  } finally {
    await app.close();
  }
});
test("seven locale successes preserve the current response while substituted locale is rejected", async () => {
  const { app, execute } = await setup();
  try {
    for (const locale of SUPPORTED_LOCALES) {
      const expected = storefrontHomepageFixture(locale);
      execute.mockResolvedValue(expected);
      const reply = await app.inject({
        method: "GET",
        url: `/api/v1/storefront-homepage?locale=${locale}`,
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual(expected);
    }
    execute.mockResolvedValue(storefrontHomepageFixture("en"));
    const reply = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-homepage?locale=ja",
    });
    expect(reply.statusCode).toBe(503);
    expect(reply.json()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  } finally {
    await app.close();
  }
});
