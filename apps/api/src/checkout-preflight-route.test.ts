import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { registerCheckoutPreflightRoute } from "./checkout-preflight-route.js";

const origin = "https://shop.example.invalid";
const id = "10000000-0000-4000-8000-000000000001";
const validate = {
  schemaVersion: 1,
  expectedCartVersion: 2,
  presentationLocale: "ja",
};
const create = {
  schemaVersion: 1,
  preflightId: id,
  expectedCartVersion: 2,
  email: ["checkout", "example.test"].join("@"),
  policyAcceptances: [
    {
      policyKey: "terms",
      policyRevisionId: id,
      policyTranslationRevisionId: id,
      accepted: true,
    },
  ],
};
const paths = {
  validate: "/api/v1/cart/validate",
  create: "/api/v1/checkout/sessions",
  read: `/api/v1/checkout/sessions/${id}/status`,
};
type Action = keyof typeof paths;

async function setup() {
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
            digestBase64: createHmac("sha256", "TEST_CHECKOUT_KEY")
              .update(command.purpose)
              .update(command.valueBase64)
              .digest("base64url"),
          },
        };
      },
    },
  });
  const failure = async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  });
  const useCases = {
    validate: vi.fn<(...args: unknown[]) => Promise<unknown>>(failure),
    create: vi.fn<(...args: unknown[]) => Promise<unknown>>(failure),
    read: vi.fn<(...args: unknown[]) => Promise<unknown>>(failure),
  };
  registerCheckoutPreflightRoute(app, {
    allowedOrigin: origin,
    credentials,
    useCases,
  });
  const issued = await credentials.issue();
  async function send(
    action: Action,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      url?: string;
      method?: "GET" | "POST";
    } = {},
  ) {
    return app.inject({
      method: options.method ?? (action === "read" ? "GET" : "POST"),
      url: options.url ?? paths[action],
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `__Host-fan-cart=${issued.token}`,
        "x-csrf-token": issued.csrfToken,
        "idempotency-key": "checkout-create-test-0001",
        ...options.headers,
      },
      ...(action !== "read" || options.body !== undefined
        ? {
            payload: JSON.stringify(
              options.body ?? (action === "validate" ? validate : create),
            ),
          }
        : {}),
    });
  }
  return { app, send, useCases, issued };
}

test("three checkout endpoints derive trusted operations and established cart access, never raw credentials", async () => {
  const { app, send, useCases, issued } = await setup();
  try {
    for (const action of ["validate", "create", "read"] as const) {
      const result = await send(action);
      expect(result.statusCode).toBe(409);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(result.headers["referrer-policy"]).toBe("no-referrer");
      expect(result.headers["set-cookie"]).toBeUndefined();
      const [command, context] = useCases[action].mock.calls[0]!;
      expect(command).toEqual(
        action === "validate"
          ? { ...validate, operation: "VALIDATE_CHECKOUT" }
          : action === "create"
            ? { ...create, operation: "CREATE_CHECKOUT" }
            : {
                schemaVersion: 1,
                operation: "READ_CHECKOUT",
                checkoutSessionId: id,
              },
      );
      expect(context).toMatchObject({
        schemaVersion: 1,
        accesses: [{ schemaVersion: 1, pepperVersion: "test-v1" }],
      });
      expect(JSON.stringify(context)).not.toContain(issued.token);
      expect(JSON.stringify(context)).not.toContain(issued.csrfToken);
      expect(context).not.toHaveProperty("email");
      if (action !== "read")
        expect(context).toHaveProperty(
          "idempotencyKey",
          "checkout-create-test-0001",
        );
      else expect(context).not.toHaveProperty("idempotencyKey");
    }
  } finally {
    await app.close();
  }
});

test("checkout requires cookie authorization and exact Origin plus cookie-bound CSRF on both POST operations", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const action of ["validate", "create", "read"] as const) {
      expect((await send(action, { headers: { cookie: "" } })).statusCode).toBe(
        401,
      );
      expect(
        (
          await send(action, {
            headers: { origin: "https://other.example.invalid" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await send(action, { headers: { "sec-fetch-site": "cross-site" } }))
          .statusCode,
      ).toBe(403);
      if (action !== "read")
        expect(
          (await send(action, { headers: { "x-csrf-token": "wrong" } }))
            .statusCode,
        ).toBe(403);
      expect(useCases[action]).not.toHaveBeenCalled();
    }
    expect(
      (await send("read", { headers: { "x-csrf-token": "" } })).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

test("checkout accepts no browser amount, locale rewrite, duplicate policy, query or path identity override", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const body of [
      { ...validate, amountMinor: 1 },
      { ...validate, operation: "VALIDATE_CHECKOUT" },
      { ...validate, expectedCartVersion: 0 },
    ])
      expect((await send("validate", { body })).statusCode).toBe(400);
    for (const body of [
      { ...create, totalAmountMinor: 1 },
      { ...create, presentationLocale: "en" },
      { ...create, email: "invalid" },
      {
        ...create,
        policyAcceptances: [
          create.policyAcceptances[0],
          create.policyAcceptances[0],
        ],
      },
      { ...create, policyAcceptances: [] },
      { ...create, idempotencyKey: "forged" },
    ])
      expect((await send("create", { body })).statusCode).toBe(400);
    for (const action of ["validate", "create", "read"] as const) {
      expect(
        (await send(action, { url: `${paths[action]}?presentationLocale=en` }))
          .statusCode,
      ).toBe(400);
      expect(useCases[action]).not.toHaveBeenCalled();
    }
    expect(
      (await send("read", { url: "/api/v1/checkout/sessions/invalid/status" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await send("read", {
          body: { schemaVersion: 1, checkoutSessionId: id },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

test("both persisted POST operations require header idempotency and parser failures retain private responses", async () => {
  const { app, send, useCases } = await setup();
  try {
    expect(
      (await send("create", { headers: { "idempotency-key": "" } })).statusCode,
    ).toBe(400);
    expect(
      (await send("validate", { headers: { "idempotency-key": "" } }))
        .statusCode,
    ).toBe(400);
    const tooLarge = await send("create", {
      body: { ...create, email: "a".repeat(9000) },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.headers["cache-control"]).toBe("private, no-store");
    expect(useCases.create).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("checkout maps missing sessions and expired carts safely without reflecting private errors", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const [code, status] of [
      ["CHECKOUT_NOT_FOUND", 404],
      ["PREFLIGHT_NOT_FOUND", 404],
      ["PREFLIGHT_EXPIRED", 409],
      ["POLICY_CHANGED", 409],
      ["TEMPORARY_UNAVAILABLE", 503],
    ] as const) {
      useCases.read.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      expect((await send("read")).statusCode).toBe(status);
    }
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CART_EXPIRED",
    });
    expect((await send("read")).headers["set-cookie"]).toContain("Max-Age=0");
  } finally {
    await app.close();
  }
});

test("post-dispatch persisted POST exceptions or invalid responses are uncertain while reads remain unavailable", async () => {
  const { app, send, useCases } = await setup();
  try {
    for (const action of ["validate", "create", "read"] as const) {
      for (const mode of ["throw", "invalid"] as const) {
        if (mode === "throw")
          useCases[action].mockRejectedValueOnce(new Error(create.email));
        else
          useCases[action].mockResolvedValueOnce({
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "VERSION_CONFLICT",
            email: create.email,
          });
        const result = await send(action);
        expect(result.statusCode).toBe(503);
        expect(result.json().code).toBe(
          action !== "read"
            ? "TRANSACTION_OUTCOME_UNKNOWN"
            : "TEMPORARY_UNAVAILABLE",
        );
        expect(result.body).not.toContain(create.email);
      }
    }
  } finally {
    await app.close();
  }
});

test("success responses retain historical language and must match action, cart version and session identity", async () => {
  const { app, send, useCases } = await setup();
  const localeContext = {
    schemaVersion: 1,
    requestedLocale: "ja",
    resolvedLocale: "ja",
    fallbackUsed: false,
    translationRevision: id,
  };
  const review = {
    schemaVersion: 1,
    presentationLocale: "ja",
    market: "TEST",
    currency: "USD",
    amount: {
      schemaVersion: 1,
      currency: "USD",
      subtotalMinor: 50,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 50,
    },
    lines: [
      {
        schemaVersion: 1,
        cartItemId: id,
        idolDisplayName: "Artist",
        giftTitle: "Gift",
        giftVariantLabel: "Default",
        idolLocaleContext: localeContext,
        giftLocaleContext: localeContext,
        quantity: 1,
        unitAmountMinor: 50,
        lineSubtotalMinor: 50,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        lineTotalMinor: 50,
      },
    ],
    policies: [
      {
        schemaVersion: 1,
        policyKey: "terms",
        kind: "TERMS",
        locale: "ja",
        policyRevisionId: id,
        policyTranslationRevisionId: id,
        title: "Terms",
        body: "<p>Terms</p>",
        effectiveAt: "2026-09-08T00:00:00Z",
      },
    ],
  };
  const preflight = {
    ...review,
    id,
    cartVersion: 2,
    expiresAt: "2026-09-08T14:00:00Z",
  };
  const checkout = {
    ...review,
    id,
    publicOrderId: id,
    status: "CREATED",
    orderStatus: "PENDING_PAYMENT",
    paymentStatus: "UNPAID",
    expired: false,
    quoteRevision: 1,
    quoteExpiresAt: "2026-09-08T14:00:00Z",
  };
  try {
    useCases.validate.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "VALIDATED",
      replayed: false,
      preflight,
    });
    expect((await send("validate")).statusCode).toBe(200);
    for (const action of ["create", "read"] as const) {
      useCases[action].mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: action === "create" ? "CREATED" : "READ",
        checkout,
      });
      const response = await send(action);
      expect(response.statusCode).toBe(200);
      expect(response.json().checkout.presentationLocale).toBe("ja");
      expect(response.headers["x-csrf-token"]).toBeTruthy();
      expect(response.body).not.toContain(create.email);
    }
    useCases.validate.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "VALIDATED",
      replayed: false,
      preflight: { ...preflight, cartVersion: 3 },
    });
    expect((await send("validate")).json().code).toBe(
      "TRANSACTION_OUTCOME_UNKNOWN",
    );
    useCases.read.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      checkout: { ...checkout, id: "10000000-0000-4000-8000-000000000002" },
    });
    expect((await send("read")).json().code).toBe("TEMPORARY_UNAVAILABLE");
    useCases.create.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "READ",
      checkout,
    });
    expect((await send("create")).json().code).toBe(
      "TRANSACTION_OUTCOME_UNKNOWN",
    );
  } finally {
    await app.close();
  }
});
