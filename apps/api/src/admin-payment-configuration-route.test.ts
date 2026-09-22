import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const module = await import("./admin-payment-configuration-route.js").catch(
  () => undefined,
);
const origin = "https://admin.example.invalid",
  id = "10000000-0000-4000-8000-000000000001";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${"a".repeat(42)}A`,
  "x-csrf-token": "b".repeat(42) + "A",
  "content-type": "application/json",
};
test.each([
  [
    "save",
    "SAVE",
    {
      sourceRevisionId: null,
      expectedPublicationId: null,
      configuration: { schemaVersion: 1, channels: [], routes: [] },
    },
  ],
  ["submit", "SUBMIT", { revisionId: id, providerAccountId: id, locale: "en" }],
  [
    "approve",
    "APPROVE",
    { revisionId: id, providerAccountId: id, locale: "en" },
  ],
  [
    "publish",
    "PUBLISH",
    {
      revisionId: id,
      expectedPublicationId: null,
      validationHash: "a".repeat(64),
      reasonCode: "OPERATOR_CHANGE",
      confirmed: true,
    },
  ],
  [
    "rollback",
    "ROLLBACK",
    {
      revisionId: id,
      expectedPublicationId: null,
      validationHash: "a".repeat(64),
      reasonCode: "OPERATOR_CHANGE",
      confirmed: true,
    },
  ],
])(
  "%s binds explicit idempotency and server authority",
  async (path, action, fields) => {
    const app = Fastify({ logger: false });
    const execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action,
      revisionId: id,
      publicationId: action === "PUBLISH" || action === "ROLLBACK" ? id : null,
      generation: action === "PUBLISH" || action === "ROLLBACK" ? 1 : 0,
      replayed: false,
    }));
    expect(module?.registerAdminPaymentConfigurationRoute).toBeTypeOf(
      "function",
    );
    module!.registerAdminPaymentConfigurationRoute(app, {
      allowedOrigin: origin,
      useCases: { execute },
    });
    try {
      const url = `/api/v1/admin/payment-configuration/${path}`,
        payload = { schemaVersion: 1, ...fields };
      expect(
        (await app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const result = await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": "payment-config-command-01" },
        payload,
      });
      expect(result.statusCode).toBe(200);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            ...payload,
            action,
            idempotencyKey: "payment-config-command-01",
          },
        }),
      );
      expect(result.headers["cache-control"]).toBe("private, no-store");
      for (const field of [
        "actorId",
        "sessionToken",
        "csrfToken",
        "action",
        "requestId",
        "idempotencyKey",
        "deployedAccounts",
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              headers: {
                ...headers,
                "idempotency-key": "payment-config-command-01",
              },
              payload: { ...payload, [field]: id },
            })
          ).statusCode,
        ).toBe(400);
      }
      execute.mockResolvedValue({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "OTHER",
        revisionId: id,
        publicationId: null,
        generation: 0,
        replayed: false,
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: {
              ...headers,
              "idempotency-key": "payment-config-command-01",
            },
            payload,
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await app.close();
    }
  },
);
test("read and validate preserve private origin and authenticated CSRF boundaries", async () => {
  const app = Fastify({ logger: false }),
    execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "FORBIDDEN",
    }));
  expect(module?.registerAdminPaymentConfigurationRoute).toBeTypeOf("function");
  module!.registerAdminPaymentConfigurationRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    for (const [path, fields] of [
      ["read", { revisionId: null }],
      [
        "validate",
        { revisionId: id, expectedPublicationId: null, mode: "PUBLISH" },
      ],
    ] as const) {
      const url = `/api/v1/admin/payment-configuration/${path}`,
        payload = { schemaVersion: 1, ...fields };
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            headers: { ...headers, origin: "https://other.example.invalid" },
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
      expect(execute).not.toHaveBeenCalled();
      expect(
        (await app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(403);
      execute.mockClear();
    }
  } finally {
    await app.close();
  }
});
