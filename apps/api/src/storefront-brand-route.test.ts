import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createDefaultStorefrontBrandView } from "@fan-support/contracts";
import {
  registerStorefrontBrandRoute,
  registerPublicStorefrontBrandRoute,
} from "./storefront-brand-route.js";
const headers = {
  origin: "https://admin.example.test",
  "content-type": "application/json",
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
};
const assetId = "11111111-1111-4111-8111-111111111111";
test("logo preparation requires an idempotency key and passes only the upload reference", async () => {
  const app = Fastify();
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGO",
    logo: {
      assetId,
      url: `https://media.example.test/processed/v1/${assetId}/${"a".repeat(64)}.webp`,
      width: 320,
      height: 80,
    },
    replayed: false,
  }));
  registerStorefrontBrandRoute(app, {
    allowedOrigin: headers.origin,
    useCases: { execute },
  });
  try {
    const payload = { schemaVersion: 1, uploadId: assetId };
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/storefront-brand/prepare",
      headers,
      payload,
    });
    expect(missing.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/admin/storefront-brand/prepare",
      headers: { ...headers, "idempotency-key": "logo-prepare-test-1" },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          schemaVersion: 1,
          action: "PREPARE_LOGO",
          uploadId: assetId,
          idempotencyKey: "logo-prepare-test-1",
        },
      }),
    );
    const arbitrary = await app.inject({
      method: "POST",
      url: "/api/v1/admin/storefront-brand/prepare",
      headers: { ...headers, "idempotency-key": "logo-prepare-test-2" },
      payload: { ...payload, url: "https://external.example.test/logo.svg" },
    });
    expect(arbitrary.statusCode).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test("brand draft rejects a mismatched version and public reads reject query strings", async () => {
  const app = Fastify();
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STATE",
    state: { schemaVersion: 1, version: 2, draft: null, published: null },
    replayed: false,
  }));
  const read = vi.fn();
  registerStorefrontBrandRoute(app, {
    allowedOrigin: headers.origin,
    useCases: { execute },
  });
  registerPublicStorefrontBrandRoute(app, { useCases: { execute: read } });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/storefront-brand/draft",
      headers: { ...headers, "idempotency-key": "logo-draft-test-1" },
      payload: {
        schemaVersion: 1,
        expectedVersion: 0,
        brand: {
          schemaVersion: 1,
          lightLogoAssetId: null,
          darkLogoAssetId: null,
        },
      },
    });
    expect(response.statusCode).toBe(503);
    const publicRead = await app.inject(
      "/api/v1/storefront/storefront-brand?draft=true",
    );
    expect(publicRead.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("admin read requires origin and credentials and rejects caller-supplied identity", async () => {
  const app = Fastify(),
    execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STATE",
      state: { schemaVersion: 1, version: 0, draft: null, published: null },
      replayed: false,
    }));
  registerStorefrontBrandRoute(app, {
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
        url: "/api/v1/admin/storefront-brand/read",
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
test("public brand is uncached and infrastructure failures cannot become default success", async () => {
  const app = Fastify(),
    execute = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_BRAND",
        source: "DEFAULT",
        brand: createDefaultStorefrontBrandView(),
        version: 0,
        publicationId: null,
      })
      .mockRejectedValueOnce(new Error("database detail must not escape"));
  registerPublicStorefrontBrandRoute(app, { useCases: { execute } });
  try {
    const success = await app.inject("/api/v1/storefront/storefront-brand");
    expect(success.statusCode).toBe(200);
    expect(success.headers["cache-control"]).toBe("no-store");
    const failed = await app.inject("/api/v1/storefront/storefront-brand");
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
test("publish rejects a restore result even when its revision and version match", async () => {
  const app = Fastify();
  registerStorefrontBrandRoute(app, {
    allowedOrigin: headers.origin,
    useCases: {
      execute: async () => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STATE",
        replayed: false,
        state: {
          schemaVersion: 1,
          version: 2,
          draft: null,
          published: {
            publicationId: "22222222-2222-4222-8222-222222222222",
            revisionId: assetId,
            version: 2,
            brand: {
              schemaVersion: 1,
              lightLogoAssetId: null,
              darkLogoAssetId: null,
            },
            view: createDefaultStorefrontBrandView(),
            publishedAt: "2026-10-01T00:00:00.000Z",
            action: "RESTORE",
            restoredFromPublicationId: "33333333-3333-4333-8333-333333333333",
          },
        },
      }),
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/storefront-brand/publish",
      headers: { ...headers, "idempotency-key": "logo-publish-boundary-1" },
      payload: {
        schemaVersion: 1,
        expectedVersion: 1,
        draftRevisionId: assetId,
      },
    });
    expect(response.statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
test.each(["PUBLISH", "RESTORE"] as const)(
  "%s accepts canonical UUID casing in its committed response",
  async (action) => {
    const app = Fastify();
    const reference = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    registerStorefrontBrandRoute(app, {
      allowedOrigin: headers.origin,
      useCases: {
        execute: async () => ({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: false,
          state: {
            schemaVersion: 1,
            version: 2,
            draft: null,
            published: {
              publicationId: "22222222-2222-4222-8222-222222222222",
              revisionId: reference,
              version: 2,
              brand: {
                schemaVersion: 1,
                lightLogoAssetId: null,
                darkLogoAssetId: null,
              },
              view: createDefaultStorefrontBrandView(),
              publishedAt: "2026-10-01T00:00:00.000Z",
              action,
              restoredFromPublicationId:
                action === "RESTORE" ? reference : null,
            },
          },
        }),
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/storefront-brand/${action.toLowerCase()}`,
        headers: { ...headers, "idempotency-key": "logo-uuid-case-1" },
        payload: {
          schemaVersion: 1,
          expectedVersion: 1,
          [action === "PUBLISH" ? "draftRevisionId" : "publicationId"]:
            reference.toUpperCase(),
        },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  },
);
