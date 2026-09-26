import { expect, test } from "vitest";

import { createStripePaymentProvider } from "./provider.js";
import {
  accountId,
  apiKey,
  attemptId,
  auditLogId,
  connection,
  credentialResolver,
  error,
  fakeStripe,
  intentId,
  list,
  ok,
  orderId,
  paymentIntent,
  refund,
  refundId,
  session,
  sessionId,
  sessionReference,
} from "./test-support/fake-stripe.js";
import { StripeTransportError } from "./transport.js";

const now = () => new Date("2026-09-26T00:00:00.000Z");
const identity = {
  schemaVersion: 1,
  providerAccountId: accountId,
  environment: "TEST",
} as const;
const createCommand = {
  ...identity,
  operation: "CREATE_PAYMENT",
  attemptId,
  orderId,
  paymentMethod: "card",
  amountMinor: 2500,
  currency: "USD",
  requestedLocale: "zh-CN",
  merchantReference: attemptId,
  providerIdempotencyKey: attemptId,
  returnUrl: "https://shop.example.invalid/zh-CN/checkout/return",
  cancelUrl: "https://shop.example.invalid/zh-CN/checkout",
} as const;

function provider(routes: Parameters<typeof fakeStripe>[0]) {
  const stripe = fakeStripe(routes);
  return {
    stripe,
    provider: createStripePaymentProvider({
      connection,
      credentials: credentialResolver(),
      transport: stripe.transport,
      now,
    }),
  };
}

test("capabilities offer hosted card checkout only where Stripe can charge the amount", async () => {
  const { provider: stripe, stripe: fake } = provider({});
  const command = {
    ...identity,
    operation: "GET_CAPABILITIES",
    market: "US",
    country: "US",
    currency: "USD",
    amountMinor: 2500,
    requestedLocale: "en",
    supportedActionTypes: ["REDIRECT", "WAIT"],
  } as const;
  const response = await stripe.getCapabilities(command as never);
  expect(response).toMatchObject({
    outcome: "SUCCESS",
    value: {
      capabilities: [
        {
          paymentMethod: "card",
          currency: "USD",
          minimumAmountMinor: 50,
          maximumAmountMinor: 99_999_999,
          actionTypes: ["REDIRECT"],
          available: true,
        },
      ],
    },
  });
  expect(
    await stripe.getCapabilities({
      ...command,
      supportedActionTypes: ["PROVIDER_COMPONENT"],
    } as never),
  ).toMatchObject({ outcome: "SUCCESS", value: { capabilities: [] } });
  for (const change of [{ currency: "ISK" }, { amountMinor: 49 }])
    expect(
      await stripe.getCapabilities({ ...command, ...change } as never),
    ).toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });
  expect(fake.calls).toEqual([]);
});

test("create sends byte-stable, attempt-tagged Checkout parameters and returns the hosted redirect", async () => {
  const { provider: stripe, stripe: fake } = provider({
    "POST /v1/checkout/sessions": () => ok(session({ locale: "zh" })),
  });
  const first = await stripe.createPayment(createCommand as never);
  expect(first).toEqual({
    schemaVersion: 1,
    operation: "CREATE_PAYMENT",
    outcome: "SUCCESS",
    value: {
      status: "REQUIRES_ACTION",
      externalReference: sessionReference,
      providerLocale: "zh",
      fallbackUsed: false,
      action: {
        schemaVersion: 1,
        type: "REDIRECT",
        url: `https://checkout.stripe.com/c/pay/${sessionId}#fragment`,
      },
      observedAt: "2026-09-26T00:00:00.000Z",
      providerAccountId: accountId,
      environment: "TEST",
      attemptId,
      orderId,
      amountMinor: 2500,
      currency: "USD",
    },
  });
  await stripe.createPayment(createCommand as never);
  expect(fake.calls[0]).toEqual(fake.calls[1]);
  expect(fake.keys[0]).toBe(apiKey);
  expect(fake.calls[0]).toEqual({
    method: "POST",
    path: "/v1/checkout/sessions",
    idempotencyKey: attemptId,
    parameters: [
      ["mode", "payment"],
      ["payment_method_types[0]", "card"],
      ["line_items[0][quantity]", "1"],
      ["line_items[0][price_data][currency]", "usd"],
      ["line_items[0][price_data][unit_amount]", "2500"],
      ["line_items[0][price_data][product_data][name]", "fan-support-test"],
      ["client_reference_id", attemptId],
      ["metadata[fan_support_attempt_id]", attemptId],
      ["payment_intent_data[metadata][fan_support_attempt_id]", attemptId],
      ["success_url", createCommand.returnUrl],
      ["cancel_url", createCommand.cancelUrl],
      ["locale", "zh"],
    ],
  });
});

test("create never treats an uncertain Stripe outcome as a definite failure", async () => {
  const cases: [Parameters<typeof fakeStripe>[0][string], string][] = [
    [
      () => {
        throw new StripeTransportError();
      },
      "TIMEOUT_OUTCOME_UNKNOWN",
    ],
    [() => error(500, "api_error"), "TIMEOUT_OUTCOME_UNKNOWN"],
    [
      () => ok(session({ url: "https://evil.example/pay" })),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
    [
      () => ok(session({ client_reference_id: orderId })),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
    [() => ok(session({ amount_total: 2499 })), "MALFORMED_PROVIDER_RESPONSE"],
    [() => ok(session({ livemode: true })), "MALFORMED_PROVIDER_RESPONSE"],
  ];
  for (const [handler, code] of cases) {
    const { provider: stripe } = provider({
      "POST /v1/checkout/sessions": handler,
    });
    expect(await stripe.createPayment(createCommand as never)).toMatchObject({
      outcome: "FAILURE",
      error: { code, recovery: "RECONCILE_REQUIRED" },
    });
  }
  for (const [status, type, code, recovery] of [
    [429, "rate_limit_error", "RATE_LIMITED", "RETRY_SAME_COMMAND"],
    [
      409,
      "invalid_request_error",
      "TEMPORARY_UNAVAILABLE",
      "RETRY_SAME_COMMAND",
    ],
    [401, "authentication_error", "AUTHENTICATION_FAILED", "NONE"],
    [400, "idempotency_error", "IDEMPOTENCY_CONFLICT", "NONE"],
    [400, "invalid_request_error", "CONFIGURATION_ERROR", "NONE"],
  ] as const) {
    const { provider: stripe } = provider({
      "POST /v1/checkout/sessions": () => error(status, type),
    });
    expect(await stripe.createPayment(createCommand as never)).toMatchObject({
      error: { code, recovery },
    });
  }
});

test("create rejects foreign return origins and undeployed methods before calling Stripe", async () => {
  const { provider: stripe, stripe: fake } = provider({});
  expect(
    await stripe.createPayment({
      ...createCommand,
      returnUrl: "https://evil.example/return",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  for (const change of [{ paymentMethod: "paypal" }, { currency: "ISK" }])
    expect(
      await stripe.createPayment({ ...createCommand, ...change } as never),
    ).toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });
  expect(
    await stripe.createPayment({
      ...createCommand,
      providerAccountId: "10000000-0000-4000-8000-000000000009",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(fake.calls).toEqual([]);
});

test("payment lookups normalize every Checkout state and restore only allowed redirects", async () => {
  const lookup = {
    ...identity,
    operation: "GET_PAYMENT",
    attemptId,
    externalReference: sessionReference,
  } as const;
  const cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [
      {},
      {
        status: "REQUIRES_ACTION",
        providerLocale: "en",
        action: { type: "REDIRECT" },
      },
    ],
    [
      { payment_intent: paymentIntent({ status: "processing" }) },
      { status: "PROCESSING" },
    ],
    [
      {
        status: "complete",
        payment_status: "paid",
        url: null,
        payment_intent: paymentIntent(),
      },
      { status: "SUCCEEDED" },
    ],
    [
      { status: "complete", payment_status: "unpaid", url: null },
      { status: "PROCESSING" },
    ],
    [{ status: "expired", url: null }, { status: "EXPIRED" }],
  ];
  for (const [overrides, expected] of cases) {
    const { provider: stripe, stripe: fake } = provider({
      [`GET /v1/checkout/sessions/${sessionId}`]: () => ok(session(overrides)),
    });
    expect(await stripe.getPayment(lookup as never)).toMatchObject({
      outcome: "SUCCESS",
      value: { externalReference: sessionReference, attemptId, ...expected },
    });
    expect(fake.calls[0]?.parameters).toEqual([["expand[]", "payment_intent"]]);
  }
  for (const [handler, code] of [
    [() => error(404), "PAYMENT_NOT_FOUND"],
    [
      () => ok(session({ client_reference_id: orderId })),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
    [() => ok(session({ locale: "fr" })), "MALFORMED_PROVIDER_RESPONSE"],
    [
      () =>
        ok(
          session({
            status: "complete",
            payment_status: "paid",
            payment_intent: null,
          }),
        ),
      "MALFORMED_PROVIDER_RESPONSE",
    ],
    [() => error(503, "api_error"), "TEMPORARY_UNAVAILABLE"],
  ] as const) {
    const { provider: stripe } = provider({
      [`GET /v1/checkout/sessions/${sessionId}`]: handler,
    });
    const response = await stripe.getPayment(lookup as never);
    expect(response).toMatchObject({ outcome: "FAILURE", error: { code } });
    // Reads never demand reconcile.
    expect(response).not.toMatchObject({
      error: { recovery: "RECONCILE_REQUIRED" },
    });
  }
});

test("cancel expires an open session, and reports the real state when payment won the race", async () => {
  const command = {
    ...identity,
    operation: "CANCEL_PAYMENT",
    attemptId,
    externalReference: sessionReference,
    idempotencyKey: "60000000-0000-4000-8000-000000000006",
    reasonCode: "FAN_CANCELED",
  } as const;
  const expire = `POST /v1/checkout/sessions/${sessionId}/expire`;
  const read = `GET /v1/checkout/sessions/${sessionId}`;
  const expired = provider({
    [expire]: () => ok(session({ status: "expired", url: null })),
  });
  expect(await expired.provider.cancelPayment(command as never)).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "CANCELED" },
  });
  expect(expired.stripe.calls[0]?.idempotencyKey).toBe(command.idempotencyKey);
  const paid = provider({
    [expire]: () => error(400),
    [read]: () =>
      ok(
        session({
          status: "complete",
          payment_status: "paid",
          url: null,
          payment_intent: paymentIntent(),
        }),
      ),
  });
  expect(await paid.provider.cancelPayment(command as never)).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "SUCCEEDED" },
  });
  const stuck = provider({
    [expire]: () => error(400),
    [read]: () => ok(session()),
  });
  expect(await stuck.provider.cancelPayment(command as never)).toMatchObject({
    error: { code: "CONFIGURATION_ERROR" },
  });
  const lost = provider({
    [expire]: () => {
      throw new StripeTransportError();
    },
  });
  expect(await lost.provider.cancelPayment(command as never)).toMatchObject({
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN", recovery: "RECONCILE_REQUIRED" },
  });
});

const refundCommand = {
  ...identity,
  operation: "REFUND_PAYMENT",
  refundId,
  paymentAttemptId: attemptId,
  externalReference: sessionReference,
  refundReference: "refund-ref-1",
  amountMinor: 1000,
  currency: "USD",
  idempotencyKey: refundId,
} as const;
const paidSession = () =>
  ok(
    session({
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: paymentIntent(),
    }),
  );

test("refunds look up the platform refund before creating one, so a replay after 24 hours never refunds twice", async () => {
  const existing = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
    "GET /v1/refunds": () =>
      ok(
        list([
          refund({
            metadata: { ...refund().metadata, fan_support_refund_id: "other" },
          }),
          refund(),
        ]),
      ),
  });
  expect(
    await existing.provider.refundPayment(refundCommand as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "PROCESSING", refundId, refundReference: "refund-ref-1" },
  });
  expect(existing.stripe.calls.map((call) => call.method)).toEqual([
    "GET",
    "GET",
  ]);
  const created = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
    "GET /v1/refunds": () => ok(list([])),
    "POST /v1/refunds": () => ok(refund({ status: "pending" })),
  });
  expect(
    await created.provider.refundPayment(refundCommand as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "PROCESSING" },
  });
  expect(created.stripe.calls[2]).toEqual({
    method: "POST",
    path: "/v1/refunds",
    idempotencyKey: refundId,
    parameters: [
      ["payment_intent", intentId],
      ["amount", "1000"],
      ["metadata[fan_support_refund_id]", refundId],
      ["metadata[fan_support_refund_reference]", "refund-ref-1"],
      ["metadata[fan_support_attempt_id]", attemptId],
      ["metadata[fan_support_external_reference]", sessionReference],
    ],
  });
});

test("refunds require a paid session and an exact provider echo", async () => {
  const unpaid = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: () => ok(session()),
  });
  expect(
    await unpaid.provider.refundPayment(refundCommand as never),
  ).toMatchObject({
    error: { code: "PAYMENT_NOT_FOUND" },
  });
  const mismatched = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
    "GET /v1/refunds": () => ok(list([])),
    "POST /v1/refunds": () => ok(refund({ amount: 999 })),
  });
  expect(
    await mismatched.provider.refundPayment(refundCommand as never),
  ).toMatchObject({
    error: {
      code: "MALFORMED_PROVIDER_RESPONSE",
      recovery: "RECONCILE_REQUIRED",
    },
  });
});

const reconcileCommand = {
  ...identity,
  operation: "RECONCILE_PAYMENT",
  attemptId,
  merchantReference: attemptId,
  providerIdempotencyKey: attemptId,
  amountMinor: 2500,
  currency: "USD",
  auditLogId,
} as const;

test("reconcile with a stored reference produces matched, authenticated capture evidence", async () => {
  const { provider: stripe } = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
  });
  expect(
    await stripe.reconcilePayment({
      ...reconcileCommand,
      externalReference: sessionReference,
    } as never),
  ).toEqual({
    schemaVersion: 1,
    operation: "RECONCILE_PAYMENT",
    outcome: "SUCCESS",
    value: {
      event: {
        schemaVersion: 1,
        eventType: "PAYMENT_STATUS",
        providerAccountId: accountId,
        environment: "TEST",
        providerEventId: `reconcile:${sessionReference}:SUCCEEDED`,
        evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId },
        occurredAt: "2026-09-26T00:00:00.000Z",
        association: {
          status: "MATCHED",
          paymentAttemptId: attemptId,
          externalReference: sessionReference,
        },
        transaction: { type: "CAPTURE", providerReference: "pi.3MtwBw" },
        status: "SUCCEEDED",
        amountMinor: 2500,
        currency: "USD",
      },
    },
  });
});

test("reconcile without a stored reference finds the attempt by payment metadata, then by recent sessions", async () => {
  const byIntent = provider({
    "GET /v1/payment_intents/search": () =>
      ok({ ...list([paymentIntent()]), object: "search_result" }),
    "GET /v1/checkout/sessions": () =>
      ok(
        list([
          session({
            status: "complete",
            payment_status: "paid",
            url: null,
            payment_intent: paymentIntent(),
          }),
        ]),
      ),
  });
  expect(
    await byIntent.provider.reconcilePayment(reconcileCommand as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: {
      event: {
        status: "SUCCEEDED",
        association: { externalReference: sessionReference },
      },
    },
  });
  expect(byIntent.stripe.calls[0]?.parameters).toEqual([
    ["query", `metadata['fan_support_attempt_id']:'${attemptId}'`],
    ["limit", "10"],
  ]);
  const byScan = provider({
    "GET /v1/payment_intents/search": () =>
      ok({ ...list([]), object: "search_result" }),
    "GET /v1/checkout/sessions": (request) =>
      request.parameters?.some(([key]) => key === "starting_after")
        ? ok(list([session()]))
        : ok(
            list(
              [session({ id: "cs_test_other", client_reference_id: orderId })],
              true,
            ),
          ),
  });
  expect(
    await byScan.provider.reconcilePayment(reconcileCommand as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: { event: { status: "REQUIRES_ACTION" } },
  });
  expect(byScan.stripe.calls[2]?.parameters).toContainEqual([
    "starting_after",
    "cs_test_other",
  ]);
  const absent = provider({
    "GET /v1/payment_intents/search": () =>
      ok({ ...list([]), object: "search_result" }),
    "GET /v1/checkout/sessions": () => ok(list([])),
  });
  expect(
    await absent.provider.reconcilePayment(reconcileCommand as never),
  ).toMatchObject({
    error: { code: "PAYMENT_NOT_FOUND" },
  });
});

test("reconcile refuses amounts or currencies that differ from the frozen attempt", async () => {
  const { provider: stripe } = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: () =>
      ok(session({ currency: "eur" })),
  });
  expect(
    await stripe.reconcilePayment({
      ...reconcileCommand,
      externalReference: sessionReference,
    } as never),
  ).toMatchObject({
    error: { code: "MALFORMED_PROVIDER_RESPONSE", recovery: "NONE" },
  });
});

test("refund reconcile finds the platform refund by metadata and reports its final state", async () => {
  const command = {
    ...refundCommand,
    operation: "RECONCILE_REFUND",
    auditLogId,
  };
  const found = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
    "GET /v1/refunds": () => ok(list([refund()])),
  });
  expect(await found.provider.reconcileRefund(command as never)).toMatchObject({
    outcome: "SUCCESS",
    value: {
      refundId,
      idempotencyKey: refundId,
      event: {
        eventType: "REFUND_STATUS",
        status: "SUCCEEDED",
        refundReference: "refund-ref-1",
        transaction: { type: "REFUND", providerReference: "re.1Fixture" },
        evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId },
      },
    },
  });
  const missing = provider({
    [`GET /v1/checkout/sessions/${sessionId}`]: paidSession,
    "GET /v1/refunds": () => ok(list([])),
  });
  expect(
    await missing.provider.reconcileRefund(command as never),
  ).toMatchObject({
    error: { code: "REFUND_NOT_FOUND" },
  });
});

test("a key for the other Stripe mode or an unavailable secret store never reaches Stripe", async () => {
  for (const credentials of [
    credentialResolver({
      API_AUTH: [["sk", "live", "fixtureApiKey0123456789"].join("_")],
      WEBHOOK_VERIFY: [],
    }),
    {
      resolve: async () => {
        throw new Error("store down");
      },
    },
  ]) {
    const fake = fakeStripe({});
    const stripe = createStripePaymentProvider({
      connection,
      credentials: credentials as never,
      transport: fake.transport,
      now,
    });
    expect(
      await stripe.getPayment({
        ...identity,
        operation: "GET_PAYMENT",
        attemptId,
        externalReference: sessionReference,
      } as never),
    ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
    expect(fake.calls).toEqual([]);
  }
});
