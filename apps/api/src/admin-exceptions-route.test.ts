import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const module = await import("./admin-exceptions-route.js").catch(
  () => undefined,
);
const origin = "https://admin.example.invalid",
  id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${"a".repeat(42)}A`,
  "x-csrf-token": "b".repeat(42) + "A",
  "content-type": "application/json",
};
test.each([
  ["replay-webhook", "REPLAY_WEBHOOK", "WEBHOOK"],
  ["retry-dead-letter", "RETRY_DEAD_LETTER", "DEAD_LETTER"],
  ["reconcile-payment", "RECONCILE_PAYMENT", "PAYMENT"],
  ["retry-notification", "RETRY_NOTIFICATION", "NOTIFICATION"],
])(
  "%s binds action, target, explicit confirmation and idempotency",
  async (path, action, kind) => {
    expect(module?.registerAdminExceptionsRoute).toBeTypeOf("function");
    const target = {
      kind,
      id,
      consumerKey: kind === "DEAD_LETTER" ? "order-notifications-v1" : null,
    };
    const receipt = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action,
      target,
      operationId: other,
      replayed: false,
    };
    const execute = vi.fn(async (): Promise<unknown> => receipt),
      app = Fastify({ logger: false });
    module!.registerAdminExceptionsRoute(app, {
      allowedOrigin: origin,
      useCases: { execute },
    });
    const payload = {
        schemaVersion: 1,
        target,
        expectedVersion: "c".repeat(64),
        reasonCode: "OPERATOR_REVIEW",
        confirmed: true,
      },
      url = `/api/v1/admin/exceptions/${path}`;
    try {
      expect(
        (await app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const mutationHeaders = {
        ...headers,
        "idempotency-key": "exception-command-0001",
      };
      const result = await app.inject({
        method: "POST",
        url,
        headers: mutationHeaders,
        payload,
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            ...payload,
            action,
            idempotencyKey: "exception-command-0001",
          },
        }),
      );
      for (const field of [
        "actorId",
        "sessionId",
        "sessionToken",
        "csrfToken",
        "action",
        "requestId",
        "idempotencyKey",
      ])
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              headers: mutationHeaders,
              payload: { ...payload, [field]: id },
            })
          ).statusCode,
        ).toBe(400);
      execute.mockResolvedValue({
        ...receipt,
        target: { ...target, id: other },
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: mutationHeaders,
            payload,
          })
        ).statusCode,
      ).toBe(503);
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: { ...mutationHeaders, origin: "https://other.invalid" },
            payload,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  },
);
test.each(["context", "list", "detail"])(
  "%s remains private and validates operation response",
  async (path) => {
    expect(module?.registerAdminExceptionsRoute).toBeTypeOf("function");
    const app = Fastify({ logger: false }),
      execute = vi.fn(async (): Promise<unknown> => ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "FORBIDDEN",
      }));
    module!.registerAdminExceptionsRoute(app, {
      allowedOrigin: origin,
      useCases: { execute },
    });
    const payload =
      path === "list"
        ? {
            schemaVersion: 1,
            page: 1,
            pageSize: 10,
            category: "ALL",
            status: "OPEN",
          }
        : path === "detail"
          ? {
              schemaVersion: 1,
              target: { kind: "WEBHOOK", id, consumerKey: null },
            }
          : { schemaVersion: 1 };
    try {
      const result = await app.inject({
        method: "POST",
        url: `/api/v1/admin/exceptions/${path}`,
        headers,
        payload,
      });
      expect(result.statusCode).toBe(403);
      expect(result.headers["referrer-policy"]).toBe("no-referrer");
      expect(execute).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
