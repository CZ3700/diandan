import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createDefaultStorefrontNavigation } from "@fan-support/contracts";
import {
  registerStorefrontNavigationRoute,
  registerPublicStorefrontNavigationRoute,
} from "./storefront-navigation-route.js";
const headers = {
  origin: "https://admin.example.test",
  "content-type": "application/json",
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
};
test("admin read requires origin and credentials and rejects caller-supplied identity", async () => {
  const app = Fastify(),
    execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STATE",
      state: { schemaVersion: 1, version: 0, draft: null, published: null },
      replayed: false,
    }));
  registerStorefrontNavigationRoute(app, {
    allowedOrigin: headers.origin,
    useCases: { execute },
  });
  try {
    for (const [requestHeaders, payload, status] of [
      [headers, { schemaVersion: 1 }, 200],
      [
        { ...headers, origin: "https://other.example.test" },
        { schemaVersion: 1 },
        403,
      ],
      [headers, { schemaVersion: 1, actorId: "injected" }, 400],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/storefront-navigation/read",
        headers: requestHeaders,
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test("public navigation is uncached and infrastructure failures cannot become default success", async () => {
  const app = Fastify(),
    execute = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_NAVIGATION",
        source: "DEFAULT",
        navigation: createDefaultStorefrontNavigation(),
        version: 0,
        publicationId: null,
      })
      .mockRejectedValueOnce(new Error("database detail must not escape"));
  registerPublicStorefrontNavigationRoute(app, { useCases: { execute } });
  try {
    const success = await app.inject(
      "/api/v1/storefront/storefront-navigation",
    );
    expect(success.statusCode).toBe(200);
    expect(success.headers["cache-control"]).toBe("no-store");
    const failed = await app.inject("/api/v1/storefront/storefront-navigation");
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  } finally {
    await app.close();
  }
});
