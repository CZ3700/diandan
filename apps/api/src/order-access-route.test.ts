import {
  orderAccessConfigurationSchema,
  type ComputeBlindIndexCommand,
} from "@fan-support/contracts";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createOrderAccessCredentials } from "./order-access-credentials.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { registerOrderAccessRoute } from "./order-access-route.js";

const origin = "https://shop.example.invalid";
const publicId = "10000000-0000-4000-8000-000000000001";
const checkoutId = "10000000-0000-4000-8000-000000000002";
const otherId = "10000000-0000-4000-8000-000000000003";
const configuration = orderAccessConfigurationSchema.parse({
  schemaVersion: 1 as const,
  publicStorefrontOrigin: origin,
  sessionTtlSeconds: 900,
  linkTtlSeconds: 3600,
  rateLimit: {
    windowSeconds: 60,
    exchangeMax: 10,
    bootstrapMax: 10,
    readMax: 100,
    revokeMax: 10,
  },
});
const grant = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "GRANTED",
  grant: {
    schemaVersion: 1,
    publicOrderId: publicId,
    expiresAt: "2099-01-01T00:00:00Z",
  },
};
const locale = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
};
const order = {
  schemaVersion: 1,
  publicOrderId: publicId,
  publicOrderNo: "FS-7K3M9C",
  presentationLocale: "en",
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  disputeStatus: "NONE",
  fulfillmentStatus: "PENDING",
  amount: {
    schemaVersion: 1,
    currency: "USD",
    subtotalMinor: 100,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
    totalAmountMinor: 100,
  },
  items: [
    {
      schemaVersion: 1,
      position: 1,
      idol: {
        handle: "test-idol",
        displayName: "Test idol",
        locale,
        portrait: {
          url: "https://media.example.invalid/test.webp",
          alt: "Test idol",
          locale,
        },
      },
      gift: {
        title: "Test gift",
        variantLabel: "Standard",
        locale,
        image: {
          url: "https://media.example.invalid/gift.webp",
          alt: "Test gift",
          locale,
        },
      },
      quantity: 1,
      unitAmountMinor: 100,
      lineSubtotalMinor: 100,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      lineTotalMinor: 100,
      currency: "USD",
      displayMode: "anonymous",
      giftKind: "PHYSICAL",
      fulfillmentStatus: "PENDING",
      deliveryProofs: [],
      supportCertificate: null,
    },
  ],
  createdAt: "2026-09-15T00:00:00Z",
  updatedAt: "2026-09-15T00:00:00Z",
};
const paths = {
  exchange: "/api/v1/order-access/exchange",
  bootstrap: `/api/v1/checkout/sessions/${checkoutId}/order-access`,
  read: `/api/v1/orders/${publicId}`,
  revoke: "/api/v1/order-access/revoke",
  locate: "/api/v1/order-access/locate",
};
type Action = keyof typeof paths;
async function setup(
  readProof?: (command: unknown) => Promise<unknown>,
  wishGallery?: {
    read(command: unknown): Promise<unknown>;
    withdraw(command: unknown): Promise<unknown>;
  },
) {
  const app = Fastify({ logger: false });
  const keyManagement = {
    async computeBlindIndex(command: ComputeBlindIndexCommand) {
      return {
        schemaVersion: 1 as const,
        operation: "COMPUTE_BLIND_INDEX" as const,
        outcome: "SUCCESS" as const,
        value: {
          algorithm: "HMAC_SHA_256" as const,
          keyVersion: command.keyVersion!,
          digestBase64: createHmac("sha256", "TEST_ORDER_ACCESS_KEY")
            .update(command.purpose)
            .update(command.valueBase64)
            .digest("base64url"),
        },
      };
    },
  };
  const credentialOptions = {
    activePepperVersion: "test-v1",
    pepperVersions: ["test-v1"],
    keyManagement,
  };
  const credentials = createOrderAccessCredentials(credentialOptions);
  const cartCredentials = createCartSessionCredentials(credentialOptions);
  const link = await credentials.issueLink(),
    session = await credentials.issueSession(),
    cart = await cartCredentials.issue();
  const useCases = {
    exchange: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => grant,
    ),
    bootstrap: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => grant,
    ),
    read: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      order,
    })),
    revoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "REVOKED",
      publicOrderId: publicId,
    })),
    locate: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "LOCATED",
      publicOrderId: publicId,
    })),
    consumeRateLimit: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({ schemaVersion: 1, allowed: true, retryAfterSeconds: 0 }),
    ),
  };
  registerOrderAccessRoute(app, {
    configuration,
    credentials,
    cartCredentials,
    useCases,
    readProof,
    wishGallery,
  });
  const send = (
    action: Action,
    options: {
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
      remoteAddress?: string;
    } = {},
  ) =>
    app.inject({
      method: action === "read" ? "GET" : "POST",
      url: options.url ?? paths[action],
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
      headers: {
        origin,
        "content-type": "application/json",
        cookie:
          action === "bootstrap"
            ? `__Host-fan-cart=${cart.token}`
            : `__Host-fan-order=${session.token}`,
        "x-csrf-token":
          action === "bootstrap" ? cart.csrfToken : session.csrfToken,
        ...options.headers,
      },
      ...(action === "read" && options.body === undefined
        ? {}
        : {
            payload: JSON.stringify(
              options.body ??
                (action === "exchange"
                  ? { schemaVersion: 1, token: link.token }
                  : action === "revoke"
                    ? { schemaVersion: 1, publicOrderId: publicId }
                    : action === "locate"
                      ? { schemaVersion: 1, publicOrderNo: "FS-7K3M9C" }
                      : { schemaVersion: 1 }),
            ),
          }),
    });
  return { app, useCases, send, credentials, link, session, cart };
}

test("exchange grants a Strict HttpOnly cookie, while commands contain only purpose-separated digests", async () => {
  const { app, send, useCases, link } = await setup();
  try {
    const response = await send("exchange");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(grant);
    expect(response.headers["set-cookie"]).toMatch(
      /^__Host-fan-order=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Expires=/u,
    );
    expect(response.headers["x-csrf-token"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const command = useCases.exchange.mock.lastCall![0];
    expect(command).toMatchObject({
      schemaVersion: 1,
      sessionTtlSeconds: 900,
      tokenCandidates: [link.access],
      sessionCredential: { schemaVersion: 1, pepperVersion: "test-v1" },
    });
    expect(JSON.stringify(command)).not.toContain(link.token);
    expect(response.body).not.toContain(link.token);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  } finally {
    await app.close();
  }
});

test("bootstrap consumes existing cart and CSRF authority while reads and revocation use the separate order cookie", async () => {
  const { app, send, useCases, cart, session } = await setup();
  try {
    expect((await send("bootstrap")).statusCode).toBe(200);
    expect(useCases.bootstrap.mock.lastCall![0]).toMatchObject({
      checkoutSessionId: checkoutId,
      cartAccesses: cart.accessCandidates,
      sessionTtlSeconds: 900,
    });
    const read = await send("read");
    expect(read.statusCode).toBe(200);
    expect(read.json().order).toEqual(order);
    expect(read.headers["x-csrf-token"]).toBe(session.csrfToken);
    expect(useCases.read.mock.lastCall![0]).toEqual({
      schemaVersion: 1,
      publicOrderId: publicId,
      sessionCandidates: [session.access],
    });
    expect(useCases.exchange).not.toHaveBeenCalled();
    const revoked = await send("revoke");
    expect(revoked.statusCode).toBe(200);
    expect(revoked.headers["set-cookie"]).toBe(
      "__Host-fan-order=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    );
    for (const action of ["bootstrap", "read", "revoke"] as const) {
      const serialized = JSON.stringify(useCases[action].mock.lastCall);
      expect(serialized).not.toContain(cart.token);
      expect(serialized).not.toContain(session.token);
      expect(serialized).not.toContain(session.csrfToken);
    }
  } finally {
    await app.close();
  }
});

test("foreign origin, same-site subdomain, query, malformed JSON/body, duplicate cookies and invalid CSRF never authorize", async () => {
  const { app, send, useCases, session } = await setup();
  try {
    for (const [action, options] of [
      ["exchange", { headers: { origin: "https://foreign.invalid" } }],
      ["exchange", { headers: { origin: "" } }],
      ["read", { headers: { "sec-fetch-site": "same-site" } }],
      ["read", { headers: { cookie: "" } }],
      [
        "read",
        {
          headers: {
            cookie: `__Host-fan-order=${session.token}; __Host-fan-order=${session.token}`,
          },
        },
      ],
      ["bootstrap", { headers: { "x-csrf-token": "invalid" } }],
      ["revoke", { headers: { "x-csrf-token": "invalid" } }],
      ["exchange", { body: { schemaVersion: 1, token: "A".repeat(42) + "B" } }],
      [
        "exchange",
        {
          body: {
            schemaVersion: 1,
            token: "A".repeat(43),
            publicOrderId: publicId,
          },
        },
      ],
      ["bootstrap", { body: { schemaVersion: 1, paid: true } }],
      ["read", { body: {} }],
      ["exchange", { headers: { "content-type": "text/plain" } }],
      ["read", { url: paths.read + "?token=invalid" }],
      ["exchange", { url: paths.exchange + "?token=invalid" }],
    ] as const)
      expect((await send(action, options)).statusCode).toBeGreaterThanOrEqual(
        400,
      );
    for (const action of Object.keys(paths) as Action[])
      expect(useCases[action]).not.toHaveBeenCalled();
    const malformed = await app.inject({
      method: "POST",
      url: paths.exchange,
      headers: { origin, "content-type": "application/json" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers["cache-control"]).toBe("private, no-store");
    const large = await app.inject({
      method: "POST",
      url: paths.exchange,
      headers: { origin, "content-type": "application/json" },
      payload: JSON.stringify({ token: "X".repeat(2048) }),
    });
    expect(large.statusCode).toBe(413);
  } finally {
    await app.close();
  }
});

test("all credential failures use the same denial and rate limiting precedes body and authorization", async () => {
  const { app, send, useCases } = await setup();
  try {
    useCases.exchange.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "ACCESS_DENIED",
    });
    const denied = await send("exchange");
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["set-cookie"]).toBeUndefined();
    useCases.consumeRateLimit.mockResolvedValueOnce({
      schemaVersion: 1,
      allowed: false,
      retryAfterSeconds: 25,
    });
    const limited = await send("exchange", { body: { invalid: true } });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("25");
    expect(limited.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "RATE_LIMITED",
    });
    expect(useCases.exchange).toHaveBeenCalledTimes(1);
    expect(useCases.consumeRateLimit.mock.lastCall![0]).toMatchObject({
      scope: "EXCHANGE",
      windowSeconds: 60,
      maxRequests: 10,
    });
  } finally {
    await app.close();
  }
});

test("rate buckets derive from the actual peer, ignoring untrusted forwarded addresses", async () => {
  const { app, send, useCases } = await setup();
  try {
    await send("read", { headers: { "x-forwarded-for": "203.0.113.7" } });
    const first = useCases.consumeRateLimit.mock.lastCall![0];
    await send("read", { headers: { "x-forwarded-for": "198.51.100.9" } });
    expect(useCases.consumeRateLimit.mock.lastCall![0]).toEqual(first);
    await send("read", { remoteAddress: "127.0.0.2" });
    expect(useCases.consumeRateLimit.mock.lastCall![0]).not.toEqual(first);
    expect(JSON.stringify(first)).not.toContain("127.0.0.1");
  } finally {
    await app.close();
  }
});

test("wrong response identity, private extra fields and unexpected failures remain private unavailable responses", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const result of [
      {
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        order: { ...order, publicOrderId: otherId },
      },
      {
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        order: { ...order, supportIntentId: otherId },
      },
      {
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "GRANTED",
        grant: grant.grant,
      },
    ]) {
      useCases.read.mockResolvedValueOnce(result);
      const response = await send("read");
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("TEMPORARY_UNAVAILABLE");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    useCases.exchange.mockRejectedValueOnce(
      new Error("PRIVATE_ORDER_DIAGNOSTIC"),
    );
    const thrown = await send("exchange");
    expect(thrown.statusCode).toBe(503);
    expect(thrown.body).not.toContain("PRIVATE_ORDER_DIAGNOSTIC");
    expect(thrown.headers["set-cookie"]).toBeUndefined();
  } finally {
    await app.close();
  }
});

test("malformed path identities are invalid requests after persisted rate counting", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const action of ["read", "bootstrap"] as const) {
      const url = paths[action].replace(
        action === "read" ? publicId : checkoutId,
        "not-an-id",
      );
      const result = await send(action, { url });
      expect(result.statusCode).toBe(400);
      expect(result.json().code).toBe("INVALID_REQUEST");
      expect(useCases[action]).not.toHaveBeenCalled();
    }
    expect(useCases.consumeRateLimit).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});

test("locate resolves a public number through the order cookie and issues no credential", async () => {
  const { app, send, useCases, session } = await setup();
  try {
    const located = await send("locate");
    expect(located.statusCode).toBe(200);
    expect(located.json()).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "LOCATED",
      publicOrderId: publicId,
    });
    expect(located.headers["set-cookie"]).toBeUndefined();
    expect(located.headers["x-csrf-token"]).toBeUndefined();
    expect(located.headers["cache-control"]).toBe("private, no-store");
    expect(useCases.locate.mock.lastCall![0]).toEqual({
      schemaVersion: 1,
      publicOrderNo: "FS-7K3M9C",
      sessionCandidates: [session.access],
    });
    expect(JSON.stringify(useCases.locate.mock.lastCall)).not.toContain(
      session.token,
    );
    expect(useCases.consumeRateLimit.mock.lastCall![0]).toMatchObject({
      scope: "READ",
    });
    for (const options of [
      { body: { schemaVersion: 1, publicOrderNo: "fs-7k3m9c" } },
      { body: { schemaVersion: 1, publicOrderNo: "7K3M9C" } },
      {
        body: {
          schemaVersion: 1,
          publicOrderNo: "FS-7K3M9C",
          publicOrderId: publicId,
        },
      },
      { headers: { cookie: "" } },
      { headers: { origin: "https://foreign.invalid" } },
    ])
      expect((await send("locate", options)).statusCode).toBeGreaterThanOrEqual(
        400,
      );
    expect(useCases.locate).toHaveBeenCalledTimes(1);
    useCases.locate.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      order,
    });
    const mismatched = await send("locate");
    expect(mismatched.statusCode).toBe(503);
    expect(mismatched.body).not.toContain(order.publicOrderNo);
    useCases.locate.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "ACCESS_DENIED",
    });
    expect((await send("locate")).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});

test("delivery photos stream only to this order's session with inert image headers", async () => {
  const proofId = "10000000-0000-4000-8000-0000000000f1";
  const url = `/api/v1/orders/${publicId}/delivery-proofs/${proofId}/thumbnail`;
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const readProof = vi.fn<(command: unknown) => Promise<unknown>>(async () => ({
    outcome: "SUCCESS",
    mimeType: "image/webp",
    bytes,
  }));
  const { app, useCases, session } = await setup(readProof);
  const get = (target: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "GET",
      url: target,
      remoteAddress: "127.0.0.1",
      headers: {
        cookie: `__Host-fan-order=${session.token}`,
        "sec-fetch-site": "same-origin",
        ...headers,
      },
    });
  try {
    const response = await get(url);
    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.rawPayload).equals(Buffer.from(bytes))).toBe(
      true,
    );
    expect(response.headers).toMatchObject({
      "content-type": "image/webp",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    });
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(readProof).toHaveBeenCalledWith({
      schemaVersion: 1,
      publicOrderId: publicId,
      proofId,
      rendition: "thumbnail",
      sessionCandidates: expect.any(Array),
    });
    expect(JSON.stringify(readProof.mock.calls)).not.toContain(session.token);
    expect(useCases.consumeRateLimit).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "READ" }),
    );
    readProof.mockClear();
    for (const [target, headers, status] of [
      [url, { cookie: "" }, 401],
      [url.replace("thumbnail", "original"), {}, 400],
      [`${url}?width=10`, {}, 400],
      [url, { "sec-fetch-site": "cross-site" }, 403],
    ] as const) {
      const denied = await get(target, headers);
      expect(denied.statusCode, target).toBe(status);
      expect(denied.headers["content-type"]).toMatch(/^application\/json/u);
    }
    expect(readProof).not.toHaveBeenCalled();
    readProof.mockResolvedValueOnce({
      outcome: "FAILURE",
      code: "ACCESS_DENIED",
    });
    expect((await get(url)).statusCode).toBe(401);
    readProof.mockResolvedValueOnce({
      outcome: "SUCCESS",
      mimeType: "image/png",
      bytes,
    });
    expect((await get(url)).statusCode).toBe(503);
  } finally {
    await app.close();
  }
  const unconfigured = await setup();
  try {
    const response = await unconfigured.app.inject({
      method: "GET",
      url,
      remoteAddress: "127.0.0.1",
      headers: { cookie: `__Host-fan-order=${unconfigured.session.token}` },
    });
    expect(response.statusCode).toBe(503);
  } finally {
    await unconfigured.app.close();
  }
});

test("wish withdrawal uses the existing order session, CSRF, origin and REVOKE rate limit", async () => {
  const entryId = otherId;
  const withdrawn = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    withdrawn: { schemaVersion: 1, entryId, withdrawn: true },
  };
  const wishGallery = {
    read: vi.fn(),
    withdraw: vi.fn().mockResolvedValue(withdrawn),
  };
  const { app, send, session, useCases } = await setup(undefined, wishGallery);
  const url = `/api/v1/orders/${publicId}/wish-gallery/${entryId}/withdraw`;
  try {
    for (const headers of [
      { cookie: "" },
      { "x-csrf-token": "" },
      { origin: "https://foreign.invalid" },
      { "sec-fetch-site": "same-site" },
    ]) {
      expect(
        (await send("revoke", { url, body: { schemaVersion: 1 }, headers }))
          .statusCode,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(wishGallery.withdraw).not.toHaveBeenCalled();
    const response = await send("revoke", { url, body: { schemaVersion: 1 } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(withdrawn);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["x-csrf-token"]).toBeUndefined();
    expect(wishGallery.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        publicOrderId: publicId,
        entryId,
        sessionCandidates: [session.access],
      }),
    );
    expect(JSON.stringify(wishGallery.withdraw.mock.calls)).not.toContain(
      session.token,
    );
    expect(useCases.consumeRateLimit).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "REVOKE" }),
    );
    useCases.consumeRateLimit.mockResolvedValueOnce({
      schemaVersion: 1,
      allowed: false,
      retryAfterSeconds: 20,
    });
    const limited = await send("revoke", { url, body: { schemaVersion: 1 } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("20");
    expect(wishGallery.withdraw).toHaveBeenCalledTimes(1);
    expect(
      (
        await send("revoke", {
          url,
          body: { schemaVersion: 1, privateName: "secret" },
        })
      ).statusCode,
    ).toBe(400);
    wishGallery.withdraw.mockResolvedValueOnce({
      ...withdrawn,
      withdrawn: { ...withdrawn.withdrawn, entryId: publicId },
    });
    expect(
      (await send("revoke", { url, body: { schemaVersion: 1 } })).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});
