import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerGiftCommerceRoute } from "./gift-commerce-route.js";

const origin = "http://localhost:3100";
const path = "/api/v1/admin/gift-commerce/context/read";
const headers = {
  origin,
  "content-type": "application/json",
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
};

test("commerce context injects its fixed action and requires strict response kind", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "COMMERCE_CONTEXT",
    permissions: ["commerce.read"],
    localeScopes: ["en"],
    markets: [],
    inventoryLocations: [],
  }));
  registerGiftCommerceRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload: { schemaVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { schemaVersion: 1, action: "CONTEXT" },
      }),
    );
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "COMMERCE_UNAVAILABLE",
    } as never);
    expect(
      (
        await app.inject({
          method: "POST",
          url: path,
          headers,
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});

test("gift creation takes idempotency only from its header and binds response action", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: "CREATE_GIFT",
    resultId: "10000000-0000-4000-8000-000000000001",
    giftId: "10000000-0000-4000-8000-000000000002",
    baseVersion: 1,
    replayed: false,
  }));
  registerGiftCommerceRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  const payload = {
    schemaVersion: 1,
    handle: "studio-gift",
    expectedBaseVersion: 0,
    reasonCode: "STUDIO_SETUP",
  };
  const url = "/api/v1/admin/gift-commerce/gifts/create";
  try {
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
    ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    const supplied = { ...headers, "idempotency-key": "create-studio-gift" };
    expect(
      (await app.inject({ method: "POST", url, headers: supplied, payload }))
        .statusCode,
    ).toBe(200);
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "SET_GIFT_STATUS",
      resultId: "10000000-0000-4000-8000-000000000001",
      giftId: "10000000-0000-4000-8000-000000000002",
      baseVersion: 2,
      replayed: false,
    });
    expect(
      (await app.inject({ method: "POST", url, headers: supplied, payload }))
        .statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});

test.each([
  ["wrong origin", { ...headers, origin: "https://untrusted.example" }, 403],
  ["missing session", { ...headers, cookie: "unrelated=value" }, 401],
  [
    "duplicate session",
    { ...headers, cookie: `${headers.cookie}; ${headers.cookie}` },
    401,
  ],
  ["missing csrf", { ...headers, "x-csrf-token": "" }, 403],
] as const)(
  "commerce read rejects %s before Application",
  async (_name, requestHeaders, status) => {
    const app = Fastify({ logger: false });
    const execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    }));
    registerGiftCommerceRoute(app, {
      allowedOrigin: origin,
      useCases: { execute },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: path,
        headers: requestHeaders,
        payload: { schemaVersion: 1 },
      });
      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.headers["x-robots-tag"]).toContain("noindex");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);

test("commerce transport rejects query credentials and parser/oversize errors privately", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }));
  registerGiftCommerceRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    for (const request of [
      { url: `${path}?token=synthetic-invalid`, payload: "{}", status: 400 },
      { url: path, payload: "{", status: 400 },
      { url: path, payload: "x".repeat(64 * 1024 + 1), status: 413 },
    ]) {
      const response = await app.inject({
        method: "POST",
        headers,
        url: request.url,
        payload: request.payload,
      });
      expect(response.statusCode).toBe(request.status);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.json()).toMatchObject({
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
