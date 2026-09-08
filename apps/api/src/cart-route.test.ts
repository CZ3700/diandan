import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerCartRoute } from "./cart-route.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";

const origin = "https://shop.example.invalid";
const body = {
  schemaVersion: 1,
  presentationLocale: "en",
  market: "GLOBAL",
  currency: "USD",
};
const cart = {
  schemaVersion: 1,
  kind: "CART_RUNTIME",
  version: 1,
  status: "ACTIVE",
  presentationLocale: "en",
  market: "GLOBAL",
  currency: "USD",
  expiresAt: "2099-01-01T00:00:00.000Z",
  items: [],
};
function setup() {
  const app = Fastify({ logger: false });
  const credentials = createCartSessionCredentials({
    activePepperVersion: "test-v1",
    pepperVersions: ["test-v1"],
    keyManagement: {
      async computeBlindIndex(command) {
        return {
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          outcome: "SUCCESS",
          value: {
            algorithm: "HMAC_SHA_256",
            keyVersion: command.keyVersion!,
            digestBase64: createHmac("sha256", "TEST_SECRET")
              .update(command.purpose)
              .update(command.valueBase64)
              .digest("base64url"),
          },
        };
      },
    },
  });
  const useCases = {
    initialize: vi.fn<() => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "INITIALIZED",
      cart,
    })),
    read: vi.fn<() => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      cart,
    })),
    add: vi.fn<() => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INSUFFICIENT_STOCK",
    })),
  };
  registerCartRoute(app, { allowedOrigin: origin, credentials, useCases });
  const initialize = () =>
    app.inject({
      method: "POST",
      url: "/api/v1/carts",
      headers: { origin, "content-type": "application/json" },
      payload: body,
    });
  return { app, credentials, useCases, initialize };
}
const addBody = {
  ...body,
  idolId: "10000000-0000-4000-8000-000000000001",
  giftId: "10000000-0000-4000-8000-000000000002",
  giftVariantId: "10000000-0000-4000-8000-000000000003",
  observedPriceId: "10000000-0000-4000-8000-000000000004",
  quantity: 1,
  displayMode: "anonymous",
  fanMessageLocale: "en",
};

test("initialize issues a secure opaque cookie while only digest candidates reach Application", async () => {
  const { app, initialize, useCases } = setup();
  try {
    const result = await initialize();
    expect(result.statusCode).toBe(200);
    const cookie = result.headers["set-cookie"] as string;
    expect(cookie).toMatch(/^__Host-fan-cart=[A-Za-z0-9_-]{43};/u);
    for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"])
      expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
    expect(result.headers["x-csrf-token"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const token = cookie.split(";")[0]!.split("=")[1]!;
    expect(JSON.stringify(useCases.initialize.mock.calls)).not.toContain(token);
    expect(result.body).not.toContain(token);
    expect(result.body).not.toContain(result.headers["x-csrf-token"]);
  } finally {
    await app.close();
  }
});

test("read requires the established cookie and exact locale query, and never rotates it", async () => {
  const { app, initialize, useCases } = setup();
  try {
    const first = await initialize();
    const cookie = (first.headers["set-cookie"] as string).split(";")[0]!;
    const result = await app.inject({
      method: "GET",
      url: "/api/v1/cart?presentationLocale=en",
      headers: { cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers["x-csrf-token"]).toBe(first.headers["x-csrf-token"]);
    expect(useCases.read).toHaveBeenCalledTimes(1);
    for (const url of [
      "/api/v1/cart",
      "/api/v1/cart?presentationLocale=en&presentationLocale=ja",
      "/api/v1/cart?presentationLocale=en&cartId=secret",
    ]) {
      expect(
        (await app.inject({ method: "GET", url, headers: { cookie } }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/cart?presentationLocale=en",
        })
      ).statusCode,
    ).toBe(401);
    expect(useCases.read).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

test("add rejects missing or mismatched credentials and enforces Origin, CSRF and header-only idempotency", async () => {
  const { app, initialize, useCases } = setup();
  try {
    const first = await initialize();
    const headers = {
      origin,
      cookie: (first.headers["set-cookie"] as string).split(";")[0]!,
      "x-csrf-token": first.headers["x-csrf-token"] as string,
      "idempotency-key": "cart-test-key-0001",
      "content-type": "application/json",
    };
    const send = (
      next: Record<string, string>,
      payload: Record<string, unknown> = addBody,
    ) =>
      app.inject({
        method: "POST",
        url: "/api/v1/cart/items",
        headers: next,
        payload,
      });
    for (const override of [
      { origin: "https://other.example.invalid" },
      { "x-csrf-token": "wrong" },
      { "sec-fetch-site": "cross-site" },
    ])
      expect((await send({ ...headers, ...override })).statusCode).toBe(403);
    expect((await send({ ...headers, cookie: "" })).statusCode).toBe(401);
    expect(
      (
        await send({
          ...headers,
          cookie: `${headers.cookie}; ${headers.cookie}`,
        })
      ).statusCode,
    ).toBe(401);
    expect((await send({ ...headers, "idempotency-key": "" })).statusCode).toBe(
      400,
    );
    for (const field of [
      "operation",
      "cartId",
      "tokenDigest",
      "sessionToken",
      "csrfToken",
      "idempotencyKey",
      "unitAmountMinor",
    ])
      expect(
        (await send(headers, { ...addBody, [field]: "untrusted" })).statusCode,
      ).toBe(400);
    expect(useCases.add).not.toHaveBeenCalled();
    expect((await send(headers)).statusCode).toBe(409);
    expect(useCases.add).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

test("failures and malformed upstream responses stay private and cannot issue a cookie", async () => {
  const { app, initialize, useCases } = setup();
  try {
    useCases.initialize.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "INITIALIZED",
      cart: { ...cart, currency: "JPY" },
    });
    const failed = await initialize();
    expect(failed.statusCode).toBe(503);
    expect(failed.headers["set-cookie"]).toBeUndefined();
    expect(failed.headers["x-csrf-token"]).toBeUndefined();
    expect(failed.headers["cache-control"]).toBe("private, no-store");
    expect(failed.headers["access-control-allow-origin"]).toBeUndefined();
    const malformed = await app.inject({
      method: "POST",
      url: "/api/v1/carts?unexpected=1",
      headers: { origin, "content-type": "application/json" },
      payload: body,
    });
    expect(malformed.statusCode).toBe(400);
    expect(useCases.initialize).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

test("expired established session is cleared once without an implicit replacement cart", async () => {
  const { app, initialize, useCases } = setup();
  try {
    const first = await initialize();
    const cookie = (first.headers["set-cookie"] as string).split(";")[0]!;
    useCases.initialize.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CART_EXPIRED",
    });
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/carts",
      headers: { origin, cookie, "content-type": "application/json" },
      payload: body,
    });
    expect(result.statusCode).toBe(409);
    expect(result.headers["set-cookie"]).toBe(
      "__Host-fan-cart=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    expect(result.headers["x-csrf-token"]).toBeUndefined();
    expect(useCases.initialize).toHaveBeenCalledTimes(2);
    expect(useCases.read).not.toHaveBeenCalled();
    expect(useCases.add).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("malformed JSON and oversized private input fail before Application with only safe errors", async () => {
  const { app, useCases } = setup();
  try {
    const canary = "PRIVATE_INPUT_MUST_NOT_ECHO";
    for (const [payload, expected] of [
      [`{${canary}`, 400],
      [JSON.stringify({ ...body, fanMessage: canary.repeat(400) }), 413],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url: "/api/v1/carts",
        headers: { origin, "content-type": "application/json" },
        payload,
      });
      expect(result.statusCode).toBe(expected);
      expect(result.body).not.toContain(canary);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.headers["set-cookie"]).toBeUndefined();
    }
    expect(useCases.initialize).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
