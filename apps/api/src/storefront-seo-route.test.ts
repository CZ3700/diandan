import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  storefrontSeoResponseSchema,
  type StorefrontSeoResponse,
} from "@fan-support/contracts";
const version = "a".repeat(64);
const entity = {
  schemaVersion: 1,
  locator: { kind: "POLICY", policyKey: "privacy" },
  publication: {
    id: "81000000-0000-4000-8000-000000000001",
    revisionId: "81000000-0000-4000-8000-000000000002",
    manifestHash: version,
    publishedAt: "2026-09-01T00:00:00.000Z",
  },
  locales: [
    {
      locale: "en",
      translationRevision: "81000000-0000-4000-8000-000000000003",
      lastModified: "2026-09-01T00:00:00.000Z",
    },
  ],
} as const;
async function setup() {
  const module = await import("./storefront-seo-route.js").catch(
    () => undefined,
  );
  expect(module, "SEO route must exist").toBeDefined();
  if (!module) throw new Error("missing route");
  const app = Fastify({ logger: false });
  const execute = vi.fn<(input: unknown) => Promise<StorefrontSeoResponse>>(
    async () => ({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" }),
  );
  module.registerStorefrontSeoRoute(app, { useCases: { execute } });
  return { app, execute };
}
test("SEO transport rejects duplicate, unknown and locale/market query fields before application", async () => {
  const { app, execute } = await setup();
  try {
    for (const path of [
      "entity",
      "entity?kind=HOMEPAGE&handle=other",
      "entity?kind=IDOL&handle=a&kind=IDOL",
      "index?locale=en",
      "catalog?market=TEST",
      "catalog?cursor=a&cursor=b",
    ])
      expect(
        (await app.inject(`/api/v1/storefront-seo/${path}`)).statusCode,
      ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (
        await app.inject(
          "/api/v1/storefront-seo/entity?kind=POLICY&policyKey=privacy",
        )
      ).statusCode,
    ).toBe(404);
    expect(execute).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      operation: "ENTITY",
      locator: { kind: "POLICY", policyKey: "privacy" },
    });
  } finally {
    await app.close();
  }
});
test("SEO response operation, entity locator and private malformed payload are bound and fail closed", async () => {
  const { app, execute } = await setup();
  try {
    execute.mockResolvedValue(
      storefrontSeoResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_ENTITY",
        entity,
      }),
    );
    const reply = await app.inject(
      "/api/v1/storefront-seo/entity?kind=POLICY&policyKey=privacy",
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    expect(
      (
        await app.inject(
          "/api/v1/storefront-seo/entity?kind=POLICY&policyKey=refund",
        )
      ).statusCode,
    ).toBe(503);
    expect((await app.inject("/api/v1/storefront-seo/index")).statusCode).toBe(
      503,
    );
    execute.mockResolvedValue({ privateKey: "secret internal" } as never);
    expect(
      (await app.inject("/api/v1/storefront-seo/index")).body,
    ).not.toContain("secret internal");
    execute.mockRejectedValue(new Error("secret internal"));
    expect(
      (await app.inject("/api/v1/storefront-seo/catalog")).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});
test("SEO cursor failure status is explicit and failures remain uncached", async () => {
  const { app, execute } = await setup();
  try {
    for (const [code, status] of [
      ["INVALID_CURSOR", 400],
      ["CATALOG_CHANGED", 409],
      ["CONTENT_UNAVAILABLE", 503],
    ] as const) {
      execute.mockResolvedValue({ schemaVersion: 1, outcome: "FAILURE", code });
      const reply = await app.inject("/api/v1/storefront-seo/index?cursor=A");
      expect(reply.statusCode).toBe(status);
      expect(reply.headers["cache-control"]).toBe("no-store");
    }
  } finally {
    await app.close();
  }
});

test("ETag 304 requires a fresh complete read and never conceals a changed publication or failure", async () => {
  const { app, execute } = await setup();
  try {
    const url = "/api/v1/storefront-seo/entity?kind=POLICY&policyKey=privacy";
    execute.mockResolvedValue(
      storefrontSeoResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_ENTITY",
        entity,
      }),
    );
    const first = await app.inject(url);
    const headers = { "if-none-match": String(first.headers.etag) };
    const unchanged = await app.inject({ url, headers });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockResolvedValue(
      storefrontSeoResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_ENTITY",
        entity: {
          ...entity,
          publication: { ...entity.publication, manifestHash: "b".repeat(64) },
        },
      }),
    );
    expect((await app.inject({ url, headers })).statusCode).toBe(200);
    const privateReply = await app.inject({
      url,
      headers: { ...headers, cookie: "session=private" },
    });
    expect(privateReply.statusCode).toBe(200);
    expect(privateReply.headers.etag).toBeUndefined();
    expect(privateReply.headers["cache-control"]).toBe("private, no-store");
    execute.mockResolvedValue(
      storefrontSeoResponseSchema.parse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      }),
    );
    const failed = await app.inject({ url, headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers.etag).toBeUndefined();
    expect(failed.headers["cache-control"]).toBe("no-store");
    for (const credentials of [
      { cookie: "session=private" },
      { authorization: "Bearer private" },
    ]) {
      const privateFailure = await app.inject({
        url,
        headers: { ...headers, ...credentials },
      });
      expect(privateFailure.statusCode).toBe(503);
      expect(privateFailure.headers.etag).toBeUndefined();
      expect(privateFailure.headers["cache-control"]).toBe("private, no-store");
    }
  } finally {
    await app.close();
  }
});
