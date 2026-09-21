import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const module = await import("./admin-finance-route.js").catch(() => undefined);
const origin = "https://admin.example.invalid",
  id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${"a".repeat(42)}A`,
  "x-csrf-token": "b".repeat(42) + "A",
  "content-type": "application/json",
};
const response = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  orderId: id,
  operationId: other,
  refundId: other,
  replayed: false,
};
const base = {
  schemaVersion: 1,
  orderId: id,
  expectedOrderVersion: 2,
  reasonCode: "CUSTOMER_REQUEST",
  confirmed: true,
};
function setup() {
  const app = Fastify({ logger: false }),
    execute = vi.fn(async (): Promise<unknown> => response);
  expect(module?.registerAdminFinanceRoute).toBeTypeOf("function");
  module!.registerAdminFinanceRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  return { app, execute };
}
test.each([
  [
    "refund",
    "REFUND",
    {
      amountMinor: 100,
      currency: "USD",
      allocations: [{ orderItemId: other, amountMinor: 100 }],
    },
  ],
  ["cancel", "CANCEL", {}],
  ["reconcile", "RECONCILE", { target: { kind: "REFUND", refundId: other } }],
])(
  "%s binds mutation, confirmation, CSRF and explicit idempotency",
  async (path, action, fields) => {
    const { app, execute } = setup();
    if (action === "CANCEL")
      execute.mockResolvedValue({ ...response, refundId: null });
    try {
      const url = `/api/v1/admin/finance/${path}`,
        payload = { ...base, ...fields };
      expect(
        (await app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const result = await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": "finance-key-0001" },
        payload,
      });
      expect(result.statusCode).toBe(200);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: { ...payload, action, idempotencyKey: "finance-key-0001" },
        }),
      );
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.headers["referrer-policy"]).toBe("no-referrer");
      for (const field of [
        "actorId",
        "sessionToken",
        "csrfToken",
        "action",
        "requestId",
        "idempotencyKey",
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              headers: { ...headers, "idempotency-key": "finance-key-0001" },
              payload: { ...payload, [field]: id },
            })
          ).statusCode,
        ).toBe(400);
      }
    } finally {
      await app.close();
    }
  },
);
test("finance read rejects mismatched output, cross-origin and missing auth", async () => {
  const { app, execute } = setup();
  const url = "/api/v1/admin/finance/list",
    payload = {
      schemaVersion: 1,
      page: 1,
      pageSize: 10,
      query: "",
      filter: "ALL",
    };
  try {
    execute.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      page: 1,
      pageSize: 10,
      totalItems: 0,
      canManage: true,
      items: [],
    });
    expect(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, origin: "https://other.invalid" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, cookie: "" },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    execute.mockResolvedValue({ ...response, orderId: other });
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/v1/admin/finance/cancel",
      headers: { ...headers, "idempotency-key": "finance-key-0002" },
      payload: base,
    });
    expect(mismatch.statusCode).toBe(503);
    expect(mismatch.json().code).toBe("TEMPORARY_UNAVAILABLE");
  } finally {
    await app.close();
  }
});
test("finance reconciliation rejects a receipt for a different refund on the same order", async () => {
  const { app, execute } = setup();
  try {
    execute.mockResolvedValue({ ...response, refundId: id });
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/admin/finance/reconcile",
      headers: { ...headers, "idempotency-key": "finance-key-0003" },
      payload: { ...base, target: { kind: "REFUND", refundId: other } },
    });
    expect(result.statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
