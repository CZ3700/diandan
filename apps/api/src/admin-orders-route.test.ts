import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const module = await import("./admin-orders-route.js").catch(() => undefined);
const origin = "https://admin.example.invalid",
  token = "a".repeat(42) + "A",
  csrf = "b".repeat(42) + "A";
const id = "10000000-0000-4000-8000-000000000001",
  itemId = "10000000-0000-4000-8000-000000000002";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
};
const context = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  actorId: id,
  permissions: ["orders.read"],
  reviewLocales: [],
};
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  orderId: id,
  resultId: itemId,
  replayed: false,
};
const base = {
  schemaVersion: 1,
  orderId: id,
  expectedOrderVersion: 2,
  reasonCode: "OPERATOR_ACTION",
};
function setup() {
  const app = Fastify({ logger: false }),
    execute = vi.fn(async (): Promise<unknown> => context);
  expect(module?.registerAdminOrdersRoute).toBeTypeOf("function");
  module!.registerAdminOrdersRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  return { app, execute };
}
function privacy(result: { headers: Record<string, unknown> }) {
  expect(result.headers["cache-control"]).toBe("private, no-store");
  expect(result.headers["referrer-policy"]).toBe("no-referrer");
  expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
}
test("orders transport injects credentials and rejects forged authority before application", async () => {
  const { app, execute } = setup();
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/admin/orders/context",
      headers,
      payload: { schemaVersion: 1 },
    });
    expect(result.statusCode).toBe(200);
    privacy(result);
    expect(result.json()).toEqual(context);
    expect(execute).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: expect.any(String),
      sessionToken: token,
      csrfToken: csrf,
      command: { schemaVersion: 1, action: "CONTEXT" },
    });
    for (const key of [
      "action",
      "actorId",
      "sessionToken",
      "csrfToken",
      "requestId",
      "sessionId",
      "idempotencyKey",
    ]) {
      const forged = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/context",
        headers,
        payload: { schemaVersion: 1, [key]: id },
      });
      expect(forged.statusCode).toBe(400);
      privacy(forged);
    }
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test.each([
  [
    "message/review",
    "REVIEW_MESSAGE",
    {
      itemId,
      expectedIntentVersion: 2,
      accessId: id,
      reviewLocale: "ja",
      languageConfirmed: true,
      decision: "APPROVED",
    },
  ],
  [
    "prepare",
    "PREPARE",
    { fulfillmentId: itemId, expectedFulfillmentVersion: 1 },
  ],
  [
    "deliver",
    "DELIVER",
    { fulfillmentId: itemId, expectedFulfillmentVersion: 1 },
  ],
  [
    "hold",
    "HOLD",
    { fulfillmentId: itemId, expectedFulfillmentVersion: 1, confirmed: true },
  ],
  [
    "resume",
    "RESUME",
    { fulfillmentId: itemId, expectedFulfillmentVersion: 1, confirmed: true },
  ],
  ["note/add", "ADD_NOTE", { note: "private fixture note" }],
  [
    "notification/resend",
    "RESEND_NOTIFICATION",
    { expectedLatestNotificationId: itemId },
  ],
])(
  "%s requires explicit mutation key and routes exact action",
  async (path, action, fields) => {
    const { app, execute } = setup();
    execute.mockResolvedValue(mutation);
    try {
      const url = `/api/v1/admin/orders/${path}`,
        payload = { ...base, ...fields };
      expect(
        (await app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const result = await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": "operation-key-0001" },
        payload,
      });
      expect(result.statusCode).toBe(200);
      privacy(result);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: { ...payload, action, idempotencyKey: "operation-key-0001" },
        }),
      );
    } finally {
      await app.close();
    }
  },
);
test("private response target is exact and cannot leak through ordinary reads", async () => {
  const { app, execute } = setup();
  const message = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MESSAGE",
    orderId: id,
    itemId,
    intentVersion: 2,
    accessId: id,
    expiresAt: "2026-09-21T12:05:00Z",
    reviewLocale: "ja",
    content: {
      displayMode: "anonymous",
      fanMessageLocale: "ja",
      fanMessage: "PRIVATE_CANARY",
    },
  };
  try {
    execute.mockResolvedValue(message);
    const payload = {
      schemaVersion: 1,
      orderId: id,
      itemId,
      expectedIntentVersion: 2,
      reviewLocale: "ja",
    };
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/admin/orders/message/read",
      headers,
      payload,
    });
    expect(ok.statusCode).toBe(200);
    privacy(ok);
    for (const value of [
      { ...message, orderId: itemId },
      { ...message, itemId: id },
      { ...message, intentVersion: 1 },
      { ...message, reviewLocale: "en" },
    ]) {
      execute.mockResolvedValueOnce(value);
      const bad = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/message/read",
        headers,
        payload,
      });
      expect(bad.statusCode).toBe(503);
      expect(bad.body).not.toContain("PRIVATE_CANARY");
    }
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/admin/orders/context",
      headers,
      payload: { schemaVersion: 1 },
    });
    expect(bad.statusCode).toBe(503);
    expect(bad.body).not.toContain("PRIVATE_CANARY");
  } finally {
    await app.close();
  }
});
test("failures are schema-safe, origin-bound and never expose private input", async () => {
  const { app, execute } = setup();
  try {
    for (const change of [
      { origin: "https://other.example.invalid" },
      { "x-csrf-token": "bad" },
      { cookie: `${headers.cookie};${headers.cookie}` },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/context",
        headers: { ...headers, ...change },
        payload: { schemaVersion: 1 },
      });
      expect([401, 403]).toContain(r.statusCode);
      privacy(r);
    }
    expect(execute).not.toHaveBeenCalled();
    execute.mockRejectedValueOnce(new Error("PRIVATE_CANARY"));
    const error = await app.inject({
      method: "POST",
      url: "/api/v1/admin/orders/context",
      headers,
      payload: { schemaVersion: 1 },
    });
    expect(error.statusCode).toBe(503);
    expect(error.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    for (const [code, status] of [
      ["TEMPORARY_UNAVAILABLE", 503],
      ["RATE_LIMITED", 429],
      ["STALE_VERSION", 409],
    ] as const) {
      execute.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/context",
        headers,
        payload: { schemaVersion: 1 },
      });
      expect(r.statusCode).toBe(status);
      privacy(r);
    }
    for (const [url, payload, status] of [
      ["context?token=secret", "{}", 400],
      ["context", "{", 400],
      ["context", JSON.stringify({ value: "x".repeat(65536) }), 413],
    ] as const) {
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/admin/orders/${url}`,
        headers,
        payload,
      });
      expect(r.statusCode).toBe(status);
      privacy(r);
    }
  } finally {
    await app.close();
  }
});
