import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  registerAdminCatalogRoute,
  registerTranslationWorkspaceRoute,
  registerTranslationTransferRoute,
  registerAdminPreviewMediaRoute,
} from "./admin-workspace-route.js";
const origin = "http://localhost:3100",
  id = "10000000-0000-4000-8000-000000000001";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
  "content-type": "application/json",
};
const failure = {
  schemaVersion: 1 as const,
  outcome: "FAILURE" as const,
  code: "NOT_FOUND" as const,
};
test("catalog list injects trusted READ action and passes only a schema validated result", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "OWNERS" as const,
    items: [],
    totalItems: 0,
    page: 1,
    pageSize: 10,
  }));
  registerAdminCatalogRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/owners/list",
      headers,
      payload: {
        schemaVersion: 1,
        kind: "IDOL",
        locale: "ja",
        page: 1,
        pageSize: 10,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          schemaVersion: 1,
          action: "LIST_OWNERS",
          kind: "IDOL",
          locale: "ja",
          page: 1,
          pageSize: 10,
        },
      }),
    );
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/owners/list",
      headers,
      payload: { schemaVersion: 1, actorId: id },
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
test("catalog mutations require header idempotency and reject body authority", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => failure);
  registerAdminCatalogRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const payload = {
      schemaVersion: 1,
      handle: "example-idol",
      expectedBaseVersion: 0,
      reasonCode: "EDITOR_CREATE",
    };
    const url = "/api/v1/admin/catalog/idols/create";
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "idempotency-key": id },
          payload,
        })
      ).statusCode,
    ).toBe(404);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { ...payload, action: "CREATE_IDOL", idempotencyKey: id },
      }),
    );
  } finally {
    await app.close();
  }
});
test("workspace and transfer keep independent read and audited export protocols", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => failure);
  registerTranslationWorkspaceRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  registerTranslationTransferRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const target = {
      owner: { kind: "HOMEPAGE" },
      revisionId: id,
      locale: "ja",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/translation-workspace/read",
          headers,
          payload: { schemaVersion: 1, target },
        })
      ).statusCode,
    ).toBe(404);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { schemaVersion: 1, action: "READ", target },
      }),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/translation-transfer/export",
          headers,
          payload: {
            schemaVersion: 1,
            target: { owner: target.owner, revisionId: id },
            locales: ["ja"],
            reasonCode: "EDITOR_EXPORT",
          },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
test("scoped media preview needs token body and exact Origin, without an admin cookie", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => failure);
  registerAdminPreviewMediaRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const payload = {
      schemaVersion: 1,
      target: { owner: { kind: "HOMEPAGE" }, revisionId: id, locale: "en" },
      token: "p".repeat(42) + "A",
    };
    const url = "/api/v1/admin-preview-media/read";
    const response = await app.inject({
      method: "POST",
      url,
      headers: { origin, "content-type": "application/json" },
      payload,
    });
    expect(response.statusCode).toBe(404);
    expect(execute).toHaveBeenCalledWith(payload);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: {
            origin: "http://localhost:3101",
            "content-type": "application/json",
          },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${url}?token=invalid`,
          headers: { origin, "content-type": "application/json" },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
