import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { registerPaymentRuntimeRoute } from "./payment-runtime-route.js";

const origin = "https://shop.example.invalid";
const providerOrigin = "https://payments.example.invalid";
const session = "10000000-0000-4000-8000-000000000001";
const attempt = "10000000-0000-4000-8000-000000000002";
const capability = "10000000-0000-4000-8000-000000000003";
const create = {
  schemaVersion: 1,
  capabilityId: capability,
  country: "US",
  configVersion: 1,
  ruleVersion: 1,
  supportedActionTypes: ["REDIRECT"],
};
const paths = {
  current: "/api/v1/checkout/current/status",
  capabilities: `/api/v1/checkout/sessions/${session}/capabilities?presentationLocale=ja&country=US&supportedActionTypes=REDIRECT`,
  create: `/api/v1/checkout/sessions/${session}/attempts`,
  read: `/api/v1/checkout/sessions/${session}/attempts/${attempt}`,
  recover: `/api/v1/checkout/sessions/${session}/attempts/${attempt}/recover`,
};
type Action = keyof typeof paths;
const view = {
  schemaVersion: 1,
  checkoutSessionId: session,
  id: attempt,
  version: 2,
  environment: "TEST",
  status: "REQUIRES_ACTION",
  requestedLocale: "ja",
  providerLocale: "en",
  providerLocaleFallbackUsed: true,
  recovery: "NONE",
  canRetry: false,
  action: {
    schemaVersion: 1,
    type: "REDIRECT",
    url: `${providerOrigin}/continue/test`,
  },
  actionExpiresAt: "2099-01-01T00:00:00Z",
  actionExpired: false,
  updatedAt: "2026-09-09T00:00:00Z",
};
async function setup(readOrigins = () => [providerOrigin]) {
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
            digestBase64: createHmac("sha256", "TEST_PAYMENT_KEY")
              .update(command.purpose)
              .update(command.valueBase64)
              .digest("base64url"),
          },
        };
      },
    },
  });
  const useCases = Object.fromEntries(
    Object.keys(paths).map((action) => [
      action,
      vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "VERSION_CONFLICT",
      })),
    ]),
  ) as Record<
    Action,
    ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  >;
  registerPaymentRuntimeRoute(app, {
    allowedOrigin: origin,
    get actionOrigins() {
      return readOrigins();
    },
    credentials,
    useCases,
  });
  const issued = await credentials.issue();
  const send = (
    action: Action,
    options: {
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) => {
    const mutation = action === "create" || action === "recover";
    return app.inject({
      method: mutation ? "POST" : "GET",
      url: options.url ?? paths[action],
      headers: {
        origin,
        cookie: `__Host-fan-cart=${issued.token}`,
        "x-csrf-token": issued.csrfToken,
        "idempotency-key": "payment-runtime-test-0001",
        "content-type": "application/json",
        ...options.headers,
      },
      ...(mutation || options.body !== undefined
        ? {
            payload: JSON.stringify(
              options.body ??
                (action === "create" ? create : { schemaVersion: 1 }),
            ),
          }
        : {}),
    });
  };
  return { app, send, useCases, issued };
}
test("five fixed endpoints derive commands and only hashed cart authority; GET remains pure", async () => {
  const { app, send, useCases, issued } = await setup();
  try {
    for (const action of Object.keys(paths) as Action[]) {
      const response = await send(action);
      expect(response.statusCode).toBe(409);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      const [command, context] = useCases[action].mock.lastCall!;
      expect(command).toMatchObject({ schemaVersion: 1 });
      expect(context).toMatchObject({
        schemaVersion: 1,
        accesses: [{ schemaVersion: 1, pepperVersion: "test-v1" }],
      });
      expect(JSON.stringify(context)).not.toContain(issued.token);
      expect(JSON.stringify(context)).not.toContain(issued.csrfToken);
      if (action === "create" || action === "recover")
        expect(context).toHaveProperty(
          "idempotencyKey",
          "payment-runtime-test-0001",
        );
      else expect(context).not.toHaveProperty("idempotencyKey");
    }
    expect(useCases.capabilities.mock.lastCall![0]).toEqual({
      schemaVersion: 1,
      operation: "READ_PAYMENT_CAPABILITIES",
      checkoutSessionId: session,
      presentationLocale: "ja",
      country: "US",
      supportedActionTypes: ["REDIRECT"],
    });
    expect(useCases.create.mock.lastCall![0]).toEqual({
      ...create,
      operation: "CREATE_PAYMENT_ATTEMPT",
      checkoutSessionId: session,
    });
    expect(useCases.recover.mock.lastCall![0]).toEqual({
      schemaVersion: 1,
      operation: "RECOVER_PAYMENT_ATTEMPT",
      checkoutSessionId: session,
      attemptId: attempt,
    });
    expect(useCases.current.mock.lastCall![0]).toEqual({
      schemaVersion: 1,
      operation: "READ_CURRENT_CHECKOUT",
    });
  } finally {
    await app.close();
  }
});
test("invalid cookie, origin, CSRF, idempotency, query and body never dispatch", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const [action, options] of [
      ["current", { headers: { cookie: "" } }],
      ["current", { headers: { cookie: "__Host-fan-cart=invalid" } }],
      ["create", { headers: { origin: "https://other.invalid" } }],
      ["recover", { headers: { "x-csrf-token": "invalid" } }],
      ["create", { headers: { "idempotency-key": "" } }],
      ["recover", { headers: { "idempotency-key": "" } }],
      ["read", { url: paths.read + "?presentationLocale=en" }],
      ["capabilities", { url: paths.capabilities + "&country=JP" }],
      ["capabilities", { url: paths.capabilities + "&amountMinor=1" }],
      [
        "capabilities",
        {
          url: paths.capabilities.replace(
            "supportedActionTypes=REDIRECT",
            "supportedActionTypes=REDIRECT,REDIRECT",
          ),
        },
      ],
      ["create", { body: { ...create, amountMinor: 1 } }],
      ["recover", { body: { schemaVersion: 1, attemptId: attempt } }],
    ] as const)
      expect((await send(action, options)).statusCode).toBeGreaterThanOrEqual(
        400,
      );
    for (const fn of Object.values(useCases)) expect(fn).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("dispatch exceptions are uncertain for mutations, temporary for pure reads, with no private details", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const action of Object.keys(paths) as Action[]) {
      useCases[action].mockRejectedValueOnce(
        new Error("private-provider-canary"),
      );
      const response = await send(action);
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe(
        action === "create" || action === "recover"
          ? "TRANSACTION_OUTCOME_UNKNOWN"
          : "TEMPORARY_UNAVAILABLE",
      );
      expect(response.body).not.toContain("private-provider-canary");
    }
  } finally {
    await app.close();
  }
});
test("success binds the exact session/attempt/action and configured hosted origin", async () => {
  const { app, send, useCases, issued } = await setup();
  try {
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: view,
    });
    const response = await send("read");
    expect(response.statusCode).toBe(200);
    expect(response.json().attempt).toEqual(view);
    expect(response.headers["x-csrf-token"]).toBe(issued.csrfToken);
    for (const change of [
      { id: capability },
      { checkoutSessionId: capability },
      {
        action: {
          ...view.action,
          url: "https://unapproved.example.invalid/pay",
        },
      },
      { email: "private-canary" },
    ]) {
      useCases.read.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        attempt: { ...view, ...change },
      });
      expect((await send("read")).statusCode).toBe(503);
    }
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CREATED",
      attempt: view,
    });
    expect((await send("read")).statusCode).toBe(503);
    useCases.current.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "EMPTY",
    });
    expect((await send("current")).json().action).toBe("EMPTY");
  } finally {
    await app.close();
  }
});
test("typed expiry clears only the existing host cookie and reads never invoke recovery", async () => {
  const { app, send, useCases } = await setup();
  try {
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CART_EXPIRED",
    });
    const response = await send("read");
    expect(response.statusCode).toBe(409);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(useCases.recover).not.toHaveBeenCalled();
    expect(useCases.create).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("hosted action validation follows the newly published directory and retains exact origin restrictions", async () => {
  let origins = [providerOrigin];
  const { app, send, useCases } = await setup(() => origins);
  const nextOrigin = "https://new-payments.example.invalid";
  try {
    await app.ready();
    origins = [providerOrigin, nextOrigin];
    for (const action of ["create", "read", "recover"] as const) {
      useCases[action].mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action:
          action === "create"
            ? "CREATED"
            : action === "read"
              ? "READ"
              : "RECOVERED",
        attempt: {
          ...view,
          action: { ...view.action, url: `${nextOrigin}/continue/test` },
        },
      });
      expect((await send(action)).statusCode).toBe(200);
    }
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: view,
    });
    expect((await send("read")).statusCode).toBe(200);
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      attempt: {
        ...view,
        action: {
          ...view.action,
          url: "https://unregistered.example.invalid/continue",
        },
      },
    });
    expect((await send("read")).statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
