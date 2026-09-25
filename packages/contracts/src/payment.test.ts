import { expect, test } from "vitest";

type Schema = Readonly<{
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

async function loadPaymentModule() {
  return import("./payment.js").catch(() => undefined) as Promise<
    Readonly<Record<string, Schema | undefined>> | undefined
  >;
}

test("allows only the five browser-safe payment action variants", async () => {
  const payment = await loadPaymentModule();
  const schema = payment?.["paymentActionSchema"];

  expect(payment, "payment contract module must exist").toBeDefined();
  expect(schema, "PaymentAction schema must be exported").toBeDefined();

  const actions = [
    {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://pay.example.invalid/redirect",
    },
    {
      schemaVersion: 1,
      type: "PROVIDER_HOSTED_IFRAME",
      url: "https://pay.example.invalid/frame",
    },
    {
      schemaVersion: 1,
      type: "PROVIDER_COMPONENT",
      componentKey: "hosted-fields",
      clientToken: "C".repeat(43),
    },
    {
      schemaVersion: 1,
      type: "QR_CODE",
      payload: "provider-qr-payload",
      expiresAt: "2026-09-03T01:00:00Z",
    },
    {
      schemaVersion: 1,
      type: "WAIT",
      pollAfterMs: 2_000,
    },
  ];

  for (const action of actions) {
    expect((schema as Schema).safeParse(action).success).toBe(true);
  }
  for (const unsafeAction of [
    { type: "SCRIPT", html: "<script>alert(1)</script>" },
    {
      ...actions[0],
      url: "https://user:password@pay.example.invalid/redirect",
    },
    {
      ...actions[1],
      url: "https://user:password@pay.example.invalid/frame",
    },
    { ...actions[0], providerResponse: { opaque: true } },
    { ...actions[2], clientSecret: "PRIVATE_CLIENT_SECRET" },
    { ...actions[2], clientToken: undefined, sessionReference: "ambiguous" },
    { ...actions[4], execute: () => undefined },
    { ...actions[3], expiresAt: new Date() },
  ]) {
    expect((schema as Schema).safeParse(unsafeAction).success).toBe(false);
  }
});

test("separates verified normalized provider evidence from browser return and public status", async () => {
  const payment = await loadPaymentModule();
  for (const schemaName of [
    "paymentCapabilitySchema",
    "paymentAttemptSchema",
    "publicPaymentAttemptViewSchema",
    "providerEventSchema",
    "paymentReturnQuerySchema",
  ] as const) {
    expect(
      payment?.[schemaName],
      `${schemaName} must be exported`,
    ).toBeDefined();
  }

  const capabilitySchema = payment?.["paymentCapabilitySchema"] as Schema;
  const capability = {
    schemaVersion: 1,
    id: "92fc1c0f-9d3d-454e-9594-ae43f6412665",
    paymentMethod: "hosted-card",
    displayName: "Card",
    market: "US",
    country: "US",
    currency: "USD",
    minimumAmountMinor: 100,
    maximumAmountMinor: 50_000,
    actionTypes: ["REDIRECT", "PROVIDER_COMPONENT"],
    available: true,
  };
  expect(capabilitySchema.safeParse(capability).success).toBe(true);
  const withoutCountry = { ...capability } as Record<string, unknown>;
  delete withoutCountry["country"];
  expect(capabilitySchema.safeParse(withoutCountry).success).toBe(false);
  expect(
    capabilitySchema.safeParse({
      ...capability,
      minimumAmountMinor: 50_001,
    }).success,
  ).toBe(false);
  expect(
    capabilitySchema.safeParse({
      ...capability,
      providerAccountId: "3331d8c0-5483-4d35-b4f2-2ae52d22d37e",
    }).success,
  ).toBe(false);

  const providerEvent = {
    schemaVersion: 1,
    eventType: "PAYMENT_STATUS",
    providerAccountId: "3331d8c0-5483-4d35-b4f2-2ae52d22d37e",
    environment: "TEST",
    providerEventId: "evt_01_normalized",
    evidence: {
      kind: "VERIFIED_WEBHOOK",
      webhookInboxId: "e79b50ef-5c3c-4f9f-92a9-88b738df81e1",
    },
    occurredAt: "2026-09-03T00:05:00Z",
    association: {
      status: "MATCHED",
      paymentAttemptId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
      externalReference: "pay_01_normalized",
    },
    status: "SUCCEEDED",
    amountMinor: 2_500,
    currency: "USD",
  };
  const providerEventSchema = payment?.["providerEventSchema"] as Schema;
  expect(providerEventSchema.safeParse(providerEvent).success).toBe(true);
  expect(
    JSON.parse(JSON.stringify(providerEventSchema.parse(providerEvent))),
  ).toEqual(providerEvent);

  const captureEvent = {
    ...providerEvent,
    transaction: {
      type: "CAPTURE",
      providerReference: "txn_capture_01",
    },
  };
  expect(providerEventSchema.safeParse(captureEvent).success).toBe(true);
  expect(
    providerEventSchema.safeParse({
      ...captureEvent,
      transaction: { ...captureEvent.transaction, type: "VOID" },
    }).success,
  ).toBe(false);
  expect(
    providerEventSchema.safeParse({
      ...captureEvent,
      transaction: { ...captureEvent.transaction, type: "ADJUSTMENT" },
    }).success,
  ).toBe(false);
  expect(
    providerEventSchema.safeParse({
      ...captureEvent,
      evidence: {
        kind: "AUTHENTICATED_RECONCILE",
        auditLogId: "7a54d978-31e2-4af5-af72-c948ed4a1fcc",
      },
      transaction: { ...captureEvent.transaction, type: "ADJUSTMENT" },
    }).success,
  ).toBe(true);

  const unmatchedProviderEvent = {
    ...providerEvent,
    association: {
      status: "UNMATCHED",
      externalReference: "pay_01_early_webhook",
    },
  };
  expect(providerEventSchema.safeParse(unmatchedProviderEvent).success).toBe(
    true,
  );

  for (const invalidEvent of [
    { ...providerEvent, evidence: undefined },
    { ...providerEvent, evidence: { kind: "VERIFIED_WEBHOOK" } },
    { ...providerEvent, evidence: { kind: "BROWSER_RETURN" } },
    { ...providerEvent, evidenceSource: "VERIFIED_WEBHOOK" },
    { ...providerEvent, providerAccountId: undefined },
    { ...providerEvent, environment: undefined },
    { ...providerEvent, providerEventId: undefined },
    { ...providerEvent, association: { status: "UNMATCHED" } },
    {
      ...providerEvent,
      association: {
        status: "MATCHED",
        externalReference: "pay_01_normalized",
      },
    },
    {
      ...providerEvent,
      paymentAttemptId: providerEvent.association.paymentAttemptId,
    },
    { ...providerEvent, rawBody: "PRIVATE_RAW_BODY" },
    { ...providerEvent, headers: { authorization: "PRIVATE_SIGNATURE" } },
    { ...providerEvent, metadata: { cardNumber: "4111111111111111" } },
    { ...providerEvent, providerStatus: "paid" },
  ]) {
    expect(providerEventSchema.safeParse(invalidEvent).success).toBe(false);
  }

  const returnQuerySchema = payment?.["paymentReturnQuerySchema"] as Schema;
  const returnQuery = {
    schemaVersion: 1,
    attemptId: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
    state: "R".repeat(43),
  };
  expect(returnQuerySchema.safeParse(returnQuery).success).toBe(true);
  expect(
    returnQuerySchema.safeParse({ ...returnQuery, status: "SUCCEEDED" })
      .success,
  ).toBe(false);
  expect(
    returnQuerySchema.safeParse({ ...returnQuery, providerEvent }).success,
  ).toBe(false);

  const publicAttemptSchema = payment?.[
    "publicPaymentAttemptViewSchema"
  ] as Schema;
  const publicAttempt = {
    schemaVersion: 1,
    id: returnQuery.attemptId,
    status: "REQUIRES_ACTION",
    action: {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://pay.example.invalid/redirect",
    },
    updatedAt: "2026-09-03T00:04:00Z",
  };
  expect(publicAttemptSchema.safeParse(publicAttempt).success).toBe(true);
  expect(
    publicAttemptSchema.safeParse({
      ...publicAttempt,
      status: "SUCCEEDED",
    }).success,
  ).toBe(false);
  for (const privateField of [
    { providerAccountId: providerEvent.providerAccountId },
    { externalReference: "external-payment-reference" },
    { merchantReference: "merchant-reference" },
    { idempotencyKey: "idempotency-key" },
  ]) {
    expect(
      publicAttemptSchema.safeParse({ ...publicAttempt, ...privateField })
        .success,
    ).toBe(false);
  }
});

test("binds payment amounts to the persisted order snapshot and constrains refunds", async () => {
  const payment = await loadPaymentModule();
  expect(payment?.["paymentAttemptWithOrderAmountSchema"]).toBeDefined();
  expect(payment?.["refundSchema"]).toBeDefined();
  expect(payment?.["disputeSchema"]).toBeDefined();

  const amount = {
    schemaVersion: 1,
    market: "US",
    currency: "USD",
    quoteRevision: 4,
    quoteExpiresAt: "2026-09-03T01:00:00Z",
    subtotalMinor: 2_500,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
    totalAmountMinor: 2_500,
  };
  const attempt = {
    schemaVersion: 1,
    id: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
    orderId: "4f847525-ed50-44db-b2cb-319977b397e0",
    providerAccountId: "3331d8c0-5483-4d35-b4f2-2ae52d22d37e",
    environment: "TEST",
    paymentMethod: "hosted-card",
    amountMinor: 2_500,
    currency: "USD",
    requestedLocale: "es",
    providerLocale: "en",
    providerLocaleFallbackUsed: true,
    configVersion: 3,
    ruleVersion: 2,
    merchantReference: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
    providerIdempotencyKey: "0be91762-1464-45bc-b0c5-d87f03e81d7e",
    status: "CREATED",
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
  };
  const boundAttempt = {
    schemaVersion: 1,
    orderAmount: amount,
    attempt,
  };
  const boundSchema = payment?.[
    "paymentAttemptWithOrderAmountSchema"
  ] as Schema;

  expect(boundSchema.safeParse(boundAttempt).success).toBe(true);
  expect(
    boundSchema.safeParse({
      ...boundAttempt,
      attempt: {
        ...attempt,
        merchantReference: "4f847525-ed50-44db-b2cb-319977b397e0",
      },
    }).success,
  ).toBe(false);
  expect(
    boundSchema.safeParse({
      ...boundAttempt,
      attempt: {
        ...attempt,
        providerIdempotencyKey: "4f847525-ed50-44db-b2cb-319977b397e0",
      },
    }).success,
  ).toBe(false);
  expect(
    boundSchema.safeParse({
      ...boundAttempt,
      attempt: { ...attempt, amountMinor: 2_499 },
    }).success,
  ).toBe(false);
  expect(
    boundSchema.safeParse({
      ...boundAttempt,
      attempt: { ...attempt, currency: "EUR" },
    }).success,
  ).toBe(false);

  const refund = {
    schemaVersion: 1,
    id: "be3379dc-7448-4cf2-b801-af6682c10022",
    orderId: attempt.orderId,
    paymentAttemptId: attempt.id,
    capturedCurrency: "USD",
    currency: "USD",
    capturedAmountMinor: 2_500,
    requestedAmountMinor: 1_000,
    processedAmountMinor: 0,
    status: "REQUESTED",
    allocations: [
      {
        schemaVersion: 1,
        orderItemId: "94951ae7-33b0-444f-8db8-089d10106085",
        amountMinor: 1_000,
      },
    ],
    createdAt: "2026-09-03T00:10:00Z",
    updatedAt: "2026-09-03T00:10:00Z",
  };
  const refundSchema = payment?.["refundSchema"] as Schema;
  expect(refundSchema.safeParse(refund).success).toBe(true);
  for (const status of [
    "REQUESTED",
    "SUBMITTING",
    "PROCESSING",
    "FAILED",
    "UNKNOWN",
  ]) {
    expect(refundSchema.safeParse({ ...refund, status }).success).toBe(true);
  }
  expect(
    refundSchema.safeParse({
      ...refund,
      status: "SUCCEEDED",
      processedAmountMinor: refund.requestedAmountMinor,
    }).success,
  ).toBe(true);
  expect(
    refundSchema.safeParse({ ...refund, status: "SUCCEEDED" }).success,
  ).toBe(false);
  for (const invalidStatus of ["PENDING", "CANCELED"]) {
    expect(
      refundSchema.safeParse({ ...refund, status: invalidStatus }).success,
    ).toBe(false);
  }
  expect(
    refundSchema.safeParse({ ...refund, requestedAmountMinor: 2_501 }).success,
  ).toBe(false);
  expect(refundSchema.safeParse({ ...refund, currency: "EUR" }).success).toBe(
    false,
  );
});
