import { decodeAirwallexHppClientToken } from "@fan-support/contracts";
import { expect, test } from "vitest";

import { createAirwallexPaymentProvider } from "./provider.js";
import { createAirwallexSession } from "./session.js";
import {
  accountId,
  airwallexRefundId,
  apiKey,
  attemptId,
  auditLogId,
  clientId,
  clientSecret,
  connection,
  credentialResolver,
  error,
  fakeAirwallex,
  intent,
  intentId,
  intentReference,
  list,
  ok,
  orderId,
  refund,
  refundId,
  returnUrl,
} from "./test-support/fake-airwallex.js";
import { AirwallexTransportError } from "./transport.js";

const start = Date.parse("2026-09-26T00:00:00.000Z");
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
  returnUrl,
  cancelUrl: returnUrl,
} as const;
const lookup = {
  ...identity,
  attemptId,
  externalReference: intentReference,
} as const;
const refundCommand = {
  ...identity,
  operation: "REFUND_PAYMENT",
  refundId,
  paymentAttemptId: attemptId,
  externalReference: intentReference,
  refundReference: "refund-ref-1",
  amountMinor: 1000,
  currency: "USD",
  idempotencyKey: refundId,
} as const;
const intentPath = `/api/v1/pa/payment_intents/${intentId}`;
const succeeded = intent({ status: "SUCCEEDED", client_secret: null });

function provider(
  routes: Parameters<typeof fakeAirwallex>[0],
  clock: { now: number } = { now: start },
) {
  const airwallex = fakeAirwallex(routes);
  return {
    airwallex,
    provider: createAirwallexPaymentProvider({
      connection,
      credentials: credentialResolver(),
      transport: airwallex.transport,
      now: () => new Date(clock.now),
    }),
  };
}

test("capabilities offer the hosted card component only where the currency and amount are supported", async () => {
  const { provider: airwallex, airwallex: fake } = provider({});
  const command = {
    ...identity,
    operation: "GET_CAPABILITIES",
    market: "US",
    country: "US",
    currency: "USD",
    amountMinor: 2500,
    requestedLocale: "en",
    supportedActionTypes: ["REDIRECT", "PROVIDER_COMPONENT"],
  } as const;
  expect(await airwallex.getCapabilities(command as never)).toMatchObject({
    outcome: "SUCCESS",
    value: {
      capabilities: [
        {
          paymentMethod: "card",
          currency: "USD",
          minimumAmountMinor: 1,
          maximumAmountMinor: 99_999_999,
          actionTypes: ["PROVIDER_COMPONENT"],
          available: true,
        },
      ],
    },
  });
  expect(
    await airwallex.getCapabilities({
      ...command,
      supportedActionTypes: ["REDIRECT"],
    } as never),
  ).toMatchObject({ outcome: "SUCCESS", value: { capabilities: [] } });
  for (const change of [
    { currency: "KRW" },
    { amountMinor: 0 },
    { amountMinor: 100_000_000 },
  ])
    expect(
      await airwallex.getCapabilities({ ...command, ...change } as never),
    ).toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });
  expect(fake.calls).toEqual([]);
});

test("create logs in once, sends a deterministic intent and returns the hosted page component", async () => {
  const { provider: airwallex, airwallex: fake } = provider({
    "POST /api/v1/pa/payment_intents/create": () => ok(intent(), 201),
  });
  const response = await airwallex.createPayment(createCommand as never);
  expect(response).toMatchObject({
    outcome: "SUCCESS",
    value: {
      status: "REQUIRES_ACTION",
      externalReference: intentReference,
      providerLocale: "zh",
      fallbackUsed: false,
      action: {
        schemaVersion: 1,
        type: "PROVIDER_COMPONENT",
        componentKey: "airwallex-hpp",
      },
      attemptId,
      orderId,
      amountMinor: 2500,
      currency: "USD",
    },
  });
  const action = (response as { value: { action: { clientToken: string } } })
    .value.action;
  expect(decodeAirwallexHppClientToken(action.clientToken)).toEqual({
    v: 1,
    env: "sandbox",
    intentId,
    clientSecret,
    currency: "USD",
    locale: "zh",
    cancelUrl: returnUrl,
  });
  await airwallex.createPayment(createCommand as never);
  expect(fake.calls.map((call) => call.request.path)).toEqual([
    "/api/v1/authentication/login",
    "/api/v1/pa/payment_intents/create",
    "/api/v1/pa/payment_intents/create",
  ]);
  expect(fake.calls[0]).toMatchObject({
    origin: "https://api.sandbox.airwallex.com",
    authorization: { kind: "login", clientId, apiKey },
  });
  expect(fake.calls[1]?.authorization).toEqual({
    kind: "token",
    token: expect.stringMatching(/^fixture-access-token-/u),
  });
  expect(fake.calls[1]?.request).toEqual(fake.calls[2]?.request);
  expect(fake.calls[1]?.request.body).toEqual({
    request_id: attemptId,
    amount: 25,
    currency: "USD",
    merchant_order_id: attemptId,
    return_url: returnUrl,
    metadata: {
      fan_support_attempt_id: attemptId,
      fan_support_order_id: orderId,
      fan_support_requested_locale: "zh-CN",
      fan_support_cancel_url: returnUrl,
    },
  });
});

test("amounts cross the boundary as exact major-unit decimals", async () => {
  for (const [currency, amountMinor, amount] of [
    ["USD", 1999, 19.99],
    ["USD", 1, 0.01],
    ["JPY", 2500, 2500],
    ["THB", 99_999_999, 999_999.99],
  ] as const) {
    const { provider: airwallex, airwallex: fake } = provider({
      "POST /api/v1/pa/payment_intents/create": () =>
        ok(intent({ amount, currency }), 201),
    });
    expect(
      await airwallex.createPayment({
        ...createCommand,
        currency,
        amountMinor,
      } as never),
    ).toMatchObject({ outcome: "SUCCESS", value: { amountMinor } });
    expect(JSON.stringify(fake.apiCalls()[0]?.request.body)).toContain(
      `"amount":${String(amount)},`,
    );
  }
  const { provider: airwallex } = provider({
    "POST /api/v1/pa/payment_intents/create": () =>
      ok(intent({ amount: 25.001 }), 201),
  });
  expect(await airwallex.createPayment(createCommand as never)).toMatchObject({
    error: {
      code: "MALFORMED_PROVIDER_RESPONSE",
      recovery: "RECONCILE_REQUIRED",
    },
  });
});

test("a refused duplicate request finds the intent it created by merchant order ID", async () => {
  const { provider: airwallex, airwallex: fake } = provider({
    "POST /api/v1/pa/payment_intents/create": () =>
      error(400, "duplicate_request"),
    "GET /api/v1/pa/payment_intents": () =>
      ok(list([intent({ client_secret: null })])),
    [`GET ${intentPath}`]: () => ok(intent()),
  });
  expect(await airwallex.createPayment(createCommand as never)).toMatchObject({
    outcome: "SUCCESS",
    value: {
      status: "REQUIRES_ACTION",
      action: { type: "PROVIDER_COMPONENT" },
    },
  });
  expect(fake.apiCalls()[1]?.request.query).toEqual([
    ["merchant_order_id", attemptId],
    ["page_num", "0"],
    ["page_size", "10"],
  ]);
  const { provider: missing } = provider({
    "POST /api/v1/pa/payment_intents/create": () =>
      error(400, "duplicate_request"),
    "GET /api/v1/pa/payment_intents": () => ok(list([])),
  });
  expect(await missing.createPayment(createCommand as never)).toMatchObject({
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN", recovery: "RECONCILE_REQUIRED" },
  });
});

test("create rejects foreign return origins and unsupported charges before calling Airwallex", async () => {
  const { provider: airwallex, airwallex: fake } = provider({});
  expect(
    await airwallex.createPayment({
      ...createCommand,
      cancelUrl: "https://elsewhere.example.invalid/checkout",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  for (const change of [{ currency: "KRW" }, { paymentMethod: "alipaycn" }])
    expect(
      await airwallex.createPayment({ ...createCommand, ...change } as never),
    ).toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });
  expect(fake.calls).toEqual([]);
});

test("a created intent must belong to the attempt, amount and currency it was created for", async () => {
  for (const change of [
    { merchant_order_id: "70000000-0000-4000-8000-000000000007" },
    { metadata: {} },
    { currency: "EUR" },
    { status: "SUCCEEDED" },
    { client_secret: null },
    {
      metadata: {
        ...intent().metadata,
        fan_support_cancel_url: "https://elsewhere.example.invalid/x",
      },
    },
  ]) {
    const { provider: airwallex } = provider({
      "POST /api/v1/pa/payment_intents/create": () => ok(intent(change), 201),
    });
    expect(await airwallex.createPayment(createCommand as never)).toMatchObject(
      {
        error: {
          code: "MALFORMED_PROVIDER_RESPONSE",
          recovery: "RECONCILE_REQUIRED",
        },
      },
    );
  }
});

test("tokens are reused until close to expiry and a rejected token is renewed exactly once", async () => {
  const clock = { now: start };
  let rejectNext = 0;
  let issued = 0;
  const { provider: airwallex, airwallex: fake } = provider(
    {
      "POST /api/v1/authentication/login": () =>
        ok({
          token: `clock-bound-token-${String(++issued).padStart(4, "0")}`,
          expires_at: new Date(clock.now + 30 * 60_000)
            .toISOString()
            .replace(/\.\d{3}Z$/u, "+0000"),
        }),
      [`GET ${intentPath}`]: () =>
        rejectNext-- > 0 ? error(401, "unauthorized") : ok(intent()),
    },
    clock,
  );
  const get = () =>
    airwallex.getPayment({ ...lookup, operation: "GET_PAYMENT" } as never);
  await get();
  await get();
  const logins = () =>
    fake.calls.filter(
      (call) => call.request.path === "/api/v1/authentication/login",
    ).length;
  expect(logins()).toBe(1);
  clock.now = start + 29 * 60_000 + 1;
  await get();
  expect(logins()).toBe(2);
  rejectNext = 1;
  expect(await get()).toMatchObject({ outcome: "SUCCESS" });
  expect(logins()).toBe(3);
  rejectNext = 2;
  expect(await get()).toMatchObject({
    error: { code: "AUTHENTICATION_FAILED", recovery: "NONE" },
  });
});

test("concurrent calls share one login", async () => {
  const airwallex = fakeAirwallex({
    [`GET ${intentPath}`]: () => ok(intent()),
  });
  const session = createAirwallexSession({
    connection,
    credentials: credentialResolver(),
    transport: airwallex.transport,
    now: () => new Date(start),
  });
  const tokens = await Promise.all([
    session.token(1000),
    session.token(1000),
    session.token(1000),
  ]);
  expect(new Set(tokens).size).toBe(1);
  expect(airwallex.calls).toHaveLength(1);
});

test("a failed login is never an unknown payment outcome", async () => {
  for (const [login, code] of [
    [() => error(401, "unauthorized"), "AUTHENTICATION_FAILED"],
    [() => error(429, "too_many_requests"), "RATE_LIMITED"],
    [() => error(503, "internal_error"), "TEMPORARY_UNAVAILABLE"],
    [
      () => {
        throw new AirwallexTransportError();
      },
      "TEMPORARY_UNAVAILABLE",
    ],
    [() => ok({ token: "short" }), "TEMPORARY_UNAVAILABLE"],
    [() => error(400, "validation_error"), "CONFIGURATION_ERROR"],
  ] as const) {
    const { provider: airwallex, airwallex: fake } = provider({
      "POST /api/v1/authentication/login": login,
    });
    expect(await airwallex.createPayment(createCommand as never)).toMatchObject(
      { error: { code } },
    );
    expect(fake.apiCalls()).toEqual([]);
  }
  const { provider: unconfigured } = {
    provider: createAirwallexPaymentProvider({
      connection,
      credentials: credentialResolver({
        API_AUTH: ["not-a-client-pair"],
        WEBHOOK_VERIFY: ["unused-webhook-secret-0000"],
      }),
      transport: fakeAirwallex({}).transport,
    }),
  };
  expect(
    await unconfigured.createPayment(createCommand as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR", recovery: "NONE" } });
});

test("reads map every intent status and restore the component from metadata", async () => {
  for (const [status, expected] of [
    ["REQUIRES_PAYMENT_METHOD", "REQUIRES_ACTION"],
    ["REQUIRES_CUSTOMER_ACTION", "REQUIRES_ACTION"],
    ["PENDING", "PROCESSING"],
    ["PENDING_REVIEW", "PROCESSING"],
    ["SUCCEEDED", "SUCCEEDED"],
    ["CANCELLED", "CANCELED"],
  ] as const) {
    const { provider: airwallex } = provider({
      [`GET ${intentPath}`]: () => ok(intent({ status })),
    });
    const response = await airwallex.getPayment({
      ...lookup,
      operation: "GET_PAYMENT",
    } as never);
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: { status: expected, providerLocale: "zh", fallbackUsed: false },
    });
    expect("action" in (response as { value: object }).value).toBe(
      expected === "REQUIRES_ACTION",
    );
  }
  const { provider: thai } = provider({
    [`GET ${intentPath}`]: () =>
      ok(
        intent({
          metadata: {
            ...intent().metadata,
            fan_support_requested_locale: "th",
          },
        }),
      ),
  });
  expect(
    await thai.getPayment({ ...lookup, operation: "GET_PAYMENT" } as never),
  ).toMatchObject({ value: { providerLocale: "en", fallbackUsed: true } });
  for (const change of [
    { status: "REQUIRES_CAPTURE" },
    { status: "SOMETHING_NEW" },
    { merchant_order_id: "70000000-0000-4000-8000-000000000007" },
    { metadata: { fan_support_attempt_id: attemptId } },
  ]) {
    const { provider: airwallex } = provider({
      [`GET ${intentPath}`]: () => ok(intent(change)),
    });
    expect(
      await airwallex.getPayment({
        ...lookup,
        operation: "GET_PAYMENT",
      } as never),
    ).toMatchObject({
      error: { code: "MALFORMED_PROVIDER_RESPONSE", recovery: "NONE" },
    });
  }
});

test("cancel reports the cancellation, or the state that won the race", async () => {
  const cancel = {
    ...lookup,
    operation: "CANCEL_PAYMENT",
    idempotencyKey: "80000000-0000-4000-8000-000000000008",
    reasonCode: "ORDER_CANCELED",
  } as const;
  const { provider: airwallex, airwallex: fake } = provider({
    [`POST ${intentPath}/cancel`]: () => ok(intent({ status: "CANCELLED" })),
  });
  expect(await airwallex.cancelPayment(cancel as never)).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "CANCELED" },
  });
  expect(fake.apiCalls()[0]?.request.body).toEqual({
    request_id: cancel.idempotencyKey,
    cancellation_reason: "ORDER_CANCELED",
  });
  for (const [refusal, current, expected] of [
    ["invalid_status_for_operation", "SUCCEEDED", "SUCCEEDED"],
    ["invalid_status_for_operation", "PENDING", "PROCESSING"],
    ["duplicate_request", "CANCELLED", "CANCELED"],
  ] as const) {
    const { provider: raced } = provider({
      [`POST ${intentPath}/cancel`]: () => error(400, refusal),
      [`GET ${intentPath}`]: () => ok(intent({ status: current })),
    });
    expect(await raced.cancelPayment(cancel as never)).toMatchObject({
      outcome: "SUCCESS",
      value: { status: expected },
    });
  }
  const { provider: stuck } = provider({
    [`POST ${intentPath}/cancel`]: () => error(400, "duplicate_request"),
    [`GET ${intentPath}`]: () => ok(intent()),
  });
  expect(await stuck.cancelPayment(cancel as never)).toMatchObject({
    error: { code: "CONFIGURATION_ERROR" },
  });
  const { provider: unconfirmed } = provider({
    [`POST ${intentPath}/cancel`]: () => ok(intent()),
  });
  expect(await unconfirmed.cancelPayment(cancel as never)).toMatchObject({
    error: {
      code: "MALFORMED_PROVIDER_RESPONSE",
      recovery: "RECONCILE_REQUIRED",
    },
  });
});

test("refunds look before they create, and a refused duplicate is found again", async () => {
  const { provider: existing, airwallex: existingFake } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": () => ok(list([refund()])),
  });
  expect(await existing.refundPayment(refundCommand as never)).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "PROCESSING", refundReference: "refund-ref-1" },
  });
  expect(existingFake.apiCalls().map((call) => call.request.method)).toEqual([
    "GET",
    "GET",
  ]);
  const { provider: fresh, airwallex: freshFake } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": () => ok(list([])),
    "POST /api/v1/pa/refunds/create": () => ok(refund(), 201),
  });
  expect(await fresh.refundPayment(refundCommand as never)).toMatchObject({
    outcome: "SUCCESS",
  });
  expect(freshFake.apiCalls()[2]?.request.body).toEqual({
    request_id: refundId,
    payment_intent_id: intentId,
    amount: 10,
    metadata: {
      fan_support_refund_id: refundId,
      fan_support_refund_reference: "refund-ref-1",
      fan_support_attempt_id: attemptId,
      fan_support_external_reference: intentReference,
    },
  });
  let listed = 0;
  const { provider: duplicate } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": () => ok(list(listed++ === 0 ? [] : [refund()])),
    "POST /api/v1/pa/refunds/create": () => error(400, "duplicate_request"),
  });
  expect(await duplicate.refundPayment(refundCommand as never)).toMatchObject({
    outcome: "SUCCESS",
  });
  const { provider: vanished } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": () => ok(list([])),
    "POST /api/v1/pa/refunds/create": () => error(400, "duplicate_request"),
  });
  expect(await vanished.refundPayment(refundCommand as never)).toMatchObject({
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN", recovery: "RECONCILE_REQUIRED" },
  });
});

test("refund lookups page through every refund of the intent", async () => {
  const other = (index: number) =>
    refund({
      id: `rfd_other${String(index)}`,
      request_id: `90000000-0000-4000-8000-00000000000${String(index)}`,
      metadata: {},
    });
  const { provider: airwallex, airwallex: fake } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": (request) =>
      request.query?.some(([key, value]) => key === "page_num" && value === "0")
        ? ok(list([other(1), other(2)], true))
        : ok(list([refund({ status: "ACCEPTED" })])),
  });
  expect(
    await airwallex.reconcileRefund({
      ...refundCommand,
      operation: "RECONCILE_REFUND",
      auditLogId,
    } as never),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: { event: { status: "SUCCEEDED" } },
  });
  expect(
    fake
      .apiCalls()
      .filter((call) => call.request.path === "/api/v1/pa/refunds")
      .map((call) => call.request.query),
  ).toEqual([
    [
      ["payment_intent_id", intentId],
      ["page_num", "0"],
      ["page_size", "100"],
    ],
    [
      ["payment_intent_id", intentId],
      ["page_num", "1"],
      ["page_size", "100"],
    ],
  ]);
});

test("refunds need a settled payment and must match the command exactly", async () => {
  const { provider: unpaid } = provider({
    [`GET ${intentPath}`]: () => ok(intent({ status: "PENDING" })),
  });
  expect(await unpaid.refundPayment(refundCommand as never)).toMatchObject({
    error: { code: "PAYMENT_NOT_FOUND" },
  });
  for (const change of [
    { amount: 9.99 },
    { currency: "EUR" },
    { payment_intent_id: "int_other" },
    { metadata: { fan_support_refund_id: refundId } },
  ]) {
    const { provider: airwallex } = provider({
      [`GET ${intentPath}`]: () => ok(succeeded),
      "GET /api/v1/pa/refunds": () => ok(list([refund(change)])),
    });
    expect(await airwallex.refundPayment(refundCommand as never)).toMatchObject(
      {
        error: {
          code: "MALFORMED_PROVIDER_RESPONSE",
          recovery: "RECONCILE_REQUIRED",
        },
      },
    );
  }
  const { provider: unsupported, airwallex: fake } = provider({});
  expect(
    await unsupported.refundPayment({
      ...refundCommand,
      currency: "KRW",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(fake.calls).toEqual([]);
});

test("reconcile without a reference finds the attempt's intent and proves the outcome", async () => {
  const reconcile = {
    ...identity,
    operation: "RECONCILE_PAYMENT",
    attemptId,
    merchantReference: attemptId,
    providerIdempotencyKey: attemptId,
    amountMinor: 2500,
    currency: "USD",
    auditLogId,
  } as const;
  const { provider: airwallex } = provider(
    {
      "GET /api/v1/pa/payment_intents": () => ok(list([succeeded])),
      [`GET ${intentPath}`]: () => ok(succeeded),
    },
    { now: start },
  );
  expect(await airwallex.reconcilePayment(reconcile as never)).toEqual({
    schemaVersion: 1,
    operation: "RECONCILE_PAYMENT",
    outcome: "SUCCESS",
    value: {
      event: {
        schemaVersion: 1,
        eventType: "PAYMENT_STATUS",
        providerAccountId: accountId,
        environment: "TEST",
        providerEventId: `reconcile:${intentReference}:SUCCEEDED`,
        evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId },
        occurredAt: "2026-09-26T00:00:00.000Z",
        association: {
          status: "MATCHED",
          paymentAttemptId: attemptId,
          externalReference: intentReference,
        },
        transaction: { type: "CAPTURE", providerReference: intentReference },
        status: "SUCCEEDED",
        amountMinor: 2500,
        currency: "USD",
      },
    },
  });
  const { provider: absent } = provider({
    "GET /api/v1/pa/payment_intents": () => ok(list([])),
  });
  expect(await absent.reconcilePayment(reconcile as never)).toMatchObject({
    error: { code: "PAYMENT_NOT_FOUND" },
  });
  for (const listed of [
    ok(list([succeeded, succeeded])),
    ok(list([succeeded], true)),
  ]) {
    const { provider: ambiguous } = provider({
      "GET /api/v1/pa/payment_intents": () => listed,
    });
    expect(await ambiguous.reconcilePayment(reconcile as never)).toMatchObject({
      error: { code: "MALFORMED_PROVIDER_RESPONSE" },
    });
  }
  const { provider: referenced } = provider({
    [`GET ${intentPath}`]: () => ok(intent({ status: "CANCELLED" })),
  });
  expect(
    await referenced.reconcilePayment({
      ...reconcile,
      externalReference: intentReference,
    } as never),
  ).toMatchObject({
    value: { event: { status: "CANCELED", evidence: { auditLogId } } },
  });
});

test("reconciled refunds map every Airwallex refund status", async () => {
  for (const [status, expected] of [
    ["RECEIVED", "PROCESSING"],
    ["ACCEPTED", "SUCCEEDED"],
    ["SETTLED", "SUCCEEDED"],
    ["FAILED", "FAILED"],
  ] as const) {
    const { provider: airwallex } = provider({
      [`GET ${intentPath}`]: () => ok(succeeded),
      "GET /api/v1/pa/refunds": () => ok(list([refund({ status })])),
    });
    const response = await airwallex.reconcileRefund({
      ...refundCommand,
      operation: "RECONCILE_REFUND",
      auditLogId,
    } as never);
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: { event: { status: expected, refundReference: "refund-ref-1" } },
    });
    expect(
      (response as { value: { event: { transaction?: unknown } } }).value.event
        .transaction,
    ).toEqual(
      expected === "SUCCEEDED"
        ? {
            type: "REFUND",
            providerReference: airwallexRefundId.replaceAll("_", "."),
          }
        : undefined,
    );
  }
  const { provider: missing } = provider({
    [`GET ${intentPath}`]: () => ok(succeeded),
    "GET /api/v1/pa/refunds": () => ok(list([])),
  });
  expect(
    await missing.reconcileRefund({
      ...refundCommand,
      operation: "RECONCILE_REFUND",
      auditLogId,
    } as never),
  ).toMatchObject({ error: { code: "REFUND_NOT_FOUND" } });
});

test("provider errors normalize by status, code and whether the operation mutates", async () => {
  const get = { ...lookup, operation: "GET_PAYMENT" } as const;
  for (const [reply, code, recovery] of [
    [
      () => error(429, "too_many_requests"),
      "RATE_LIMITED",
      "RETRY_SAME_COMMAND",
    ],
    [
      () => error(500, "internal_error"),
      "TEMPORARY_UNAVAILABLE",
      "RETRY_SAME_COMMAND",
    ],
    [() => error(404, "resource_not_found"), "PAYMENT_NOT_FOUND", "NONE"],
    [() => error(403, "forbidden"), "AUTHENTICATION_FAILED", "NONE"],
    [
      () => {
        throw new AirwallexTransportError();
      },
      "TEMPORARY_UNAVAILABLE",
      "RETRY_SAME_COMMAND",
    ],
  ] as const) {
    const { provider: airwallex } = provider({ [`GET ${intentPath}`]: reply });
    expect(await airwallex.getPayment(get as never)).toMatchObject({
      error: { code, recovery },
    });
  }
  for (const [reply, code, recovery] of [
    [
      () => error(500, "internal_error"),
      "TIMEOUT_OUTCOME_UNKNOWN",
      "RECONCILE_REQUIRED",
    ],
    [() => error(400, "provider_declined"), "PROVIDER_DECLINED", "NONE"],
    [
      () => error(400, "currency_not_supported"),
      "CAPABILITY_UNAVAILABLE",
      "NONE",
    ],
    [() => error(400, "validation_error"), "CONFIGURATION_ERROR", "NONE"],
    [
      () => error(409, "conflict"),
      "TEMPORARY_UNAVAILABLE",
      "RETRY_SAME_COMMAND",
    ],
    [
      () => {
        throw new AirwallexTransportError();
      },
      "TIMEOUT_OUTCOME_UNKNOWN",
      "RECONCILE_REQUIRED",
    ],
  ] as const) {
    const { provider: airwallex } = provider({
      "POST /api/v1/pa/payment_intents/create": reply,
    });
    expect(await airwallex.createPayment(createCommand as never)).toMatchObject(
      { error: { code, recovery } },
    );
  }
});

test("commands for another account, environment or reference never reach Airwallex", async () => {
  const { provider: airwallex, airwallex: fake } = provider({});
  expect(
    await airwallex.getPayment({
      ...lookup,
      operation: "GET_PAYMENT",
      providerAccountId: "10000000-0000-4000-8000-000000000009",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(
    await airwallex.getPayment({
      ...lookup,
      operation: "GET_PAYMENT",
      environment: "LIVE",
    } as never),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(
    await airwallex.getPayment({
      ...lookup,
      operation: "GET_PAYMENT",
      externalReference: "cs.test.a1B2c3",
    } as never),
  ).toMatchObject({ error: { code: "PAYMENT_NOT_FOUND" } });
  expect(
    await airwallex.getPayment({ operation: "GET_PAYMENT" } as never),
  ).toMatchObject({ error: { code: "INVALID_COMMAND" } });
  expect(fake.apiCalls()).toEqual([]);
});
