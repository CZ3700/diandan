import { describe, expect, test } from "vitest";
import {
  paymentRuntimeAttemptRecordSchema,
  paymentRuntimeBeginCreateCommandSchema,
  paymentRuntimeClaimSchema,
  paymentRuntimeEncryptedActionSchema,
  paymentRuntimeRecordReconcileCommandSchema,
  paymentRuntimeSettleCreateCommandSchema,
} from "./payment-runtime-internal.js";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const now = "2026-09-09T00:00:00.000000Z";
const later = "2026-09-09T00:10:00.000000Z";
const digest = "a".repeat(64);
const encrypted = `enc:v1:${"a".repeat(43)}`;
const action = {
  schemaVersion: 1,
  type: "REDIRECT",
  ciphertext: encrypted,
  encryptedDataKey: encrypted,
  encryptionKeyVersion: "test-key-v1",
  expiresAt: later,
};
const createCommand = {
  schemaVersion: 1,
  operation: "CREATE_PAYMENT",
  providerAccountId: id(1),
  environment: "TEST",
  attemptId: id(2),
  orderId: id(3),
  paymentMethod: "fake_card",
  amountMinor: 500,
  currency: "USD",
  requestedLocale: "ja",
  merchantReference: id(2),
  providerIdempotencyKey: id(2),
  returnUrl: "https://store.example.test/ja/checkout/return",
  cancelUrl: "https://store.example.test/ja/checkout/return",
};
function attempt() {
  return {
    schemaVersion: 1,
    id: id(2),
    cartId: id(4),
    checkoutSessionId: id(5),
    orderId: id(3),
    providerAccountId: id(1),
    adapterKey: "fake",
    environment: "TEST",
    paymentMethod: "fake_card",
    amountMinor: 500,
    market: "US",
    currency: "USD",
    requestedLocale: "ja",
    providerLocale: "en",
    providerLocaleFallbackUsed: true,
    configVersionId: id(6),
    configVersion: 1,
    routeRuleId: id(7),
    ruleVersion: 1,
    merchantReference: id(2),
    providerIdempotencyKey: id(2),
    externalReference: null,
    status: "CREATED",
    version: 1,
    providerCallStarted: false,
    action: null,
    recovery: "CREATE_PENDING",
    canRetry: false,
    actionExpired: false,
    createdAt: now,
    updatedAt: now,
  };
}
function claim() {
  return {
    schemaVersion: 1,
    operationId: id(8),
    generation: 1,
    leaseTokenDigest: digest,
    leaseExpiresAt: later,
    mode: "CREATE",
    attempt: attempt(),
    createCommand,
    auditLogId: null,
    supportedActionTypes: ["REDIRECT"],
    requestId: id(9),
    correlationId: id(10),
    taskName: "payment-runtime",
  };
}
function begin() {
  return {
    schemaVersion: 1,
    accesses: [{ schemaVersion: 1, tokenDigest: digest, pepperVersion: "v1" }],
    checkoutSessionId: id(5),
    expectedOrderVersion: 2,
    receiptId: id(11),
    operationId: id(8),
    attemptId: id(2),
    idempotencyKey: "payment-create-test-0001",
    canonicalRequestHash: digest,
    configPublicationId: id(12),
    configVersionId: id(6),
    configVersion: 1,
    routeRuleId: id(7),
    ruleVersion: 1,
    country: "US",
    supportedActionTypes: ["REDIRECT"],
    providerLocale: "en",
    providerLocaleFallbackUsed: true,
    createCommand,
    returnStateDigest: digest,
    returnStateExpiresAt: later,
    leaseTokenDigest: digest,
    leaseDurationMs: 30000,
    attemptEventId: id(13),
    orderEventId: id(14),
    outboxEventId: id(15),
    requestId: id(9),
    correlationId: id(10),
    taskName: "payment-runtime",
  };
}

describe("payment runtime persistence boundaries", () => {
  test("accepts a pinned create plan and a serializable fenced claim", () => {
    expect(
      paymentRuntimeBeginCreateCommandSchema.safeParse(begin()).success,
    ).toBe(true);
    expect(
      paymentRuntimeClaimSchema.safeParse(JSON.parse(JSON.stringify(claim())))
        .success,
    ).toBe(true);
  });
  test("rejects a create plan whose outer attempt differs from its provider command", () => {
    expect(
      paymentRuntimeBeginCreateCommandSchema.safeParse({
        ...begin(),
        attemptId: id(99),
      }).success,
    ).toBe(false);
  });
  test("rejects a claim that changes its persisted amount or account", () => {
    for (const changed of [{ amountMinor: 501 }, { providerAccountId: id(99) }])
      expect(
        paymentRuntimeClaimSchema.safeParse({
          ...claim(),
          createCommand: { ...createCommand, ...changed },
        }).success,
      ).toBe(false);
  });
  test("UNKNOWN cannot be claimed for another create and reconcile requires an audit identity", () => {
    const unknown = {
      ...attempt(),
      status: "UNKNOWN",
      providerCallStarted: true,
      recovery: "RECONCILE_REQUIRED",
    };
    expect(
      paymentRuntimeClaimSchema.safeParse({ ...claim(), attempt: unknown })
        .success,
    ).toBe(false);
    expect(
      paymentRuntimeClaimSchema.safeParse({
        ...claim(),
        mode: "RECONCILE",
        attempt: unknown,
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeClaimSchema.safeParse({
        ...claim(),
        mode: "RECONCILE",
        attempt: unknown,
        auditLogId: id(16),
      }).success,
    ).toBe(true);
  });
  test("interactive next actions contain ciphertext only", () => {
    expect(paymentRuntimeEncryptedActionSchema.safeParse(action).success).toBe(
      true,
    );
    expect(
      paymentRuntimeEncryptedActionSchema.safeParse({
        ...action,
        url: "https://payments.example.test/secret",
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeEncryptedActionSchema.safeParse({
        ...action,
        ciphertext: "private-client-token",
      }).success,
    ).toBe(false);
  });
  test("stored action must match the payment status", () => {
    expect(
      paymentRuntimeAttemptRecordSchema.safeParse({ ...attempt(), action })
        .success,
    ).toBe(false);
    expect(
      paymentRuntimeAttemptRecordSchema.safeParse({
        ...attempt(),
        status: "REQUIRES_ACTION",
        recovery: "NONE",
        providerCallStarted: true,
        action,
      }).success,
    ).toBe(true);
  });
  test("a raw create result has no authority to settle SUCCEEDED", () => {
    const value = {
      schemaVersion: 1,
      claim: claim(),
      eventId: id(17),
      outboxEventId: id(18),
      retryAfterMs: 5000,
      result: {
        kind: "CREATE_RESULT",
        status: "SUCCEEDED",
        externalReference: "fake/payment/one",
        providerLocale: "en",
        providerLocaleFallbackUsed: true,
        action: null,
      },
    };
    expect(
      paymentRuntimeSettleCreateCommandSchema.safeParse(value).success,
    ).toBe(false);
  });
  test("create result preserves pinned provider locale and rejects late UNKNOWN replies", () => {
    const result = {
      kind: "CREATE_RESULT",
      status: "REQUIRES_ACTION",
      externalReference: "fake/payment/one",
      providerLocale: "en",
      providerLocaleFallbackUsed: true,
      action,
    };
    const value = {
      schemaVersion: 1,
      claim: claim(),
      eventId: id(17),
      outboxEventId: id(18),
      retryAfterMs: 5000,
      result,
    };
    expect(
      paymentRuntimeSettleCreateCommandSchema.safeParse(value).success,
    ).toBe(true);
    expect(
      paymentRuntimeSettleCreateCommandSchema.safeParse({
        ...value,
        result: { ...result, providerLocale: "ja" },
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeSettleCreateCommandSchema.safeParse({
        ...value,
        claim: { ...claim(), supportedActionTypes: ["QR_CODE"] },
      }).success,
    ).toBe(false);
  });
  test("reconcile evidence must match the actual audited claim and cannot be a webhook", () => {
    const unknown = {
      ...attempt(),
      status: "UNKNOWN",
      providerCallStarted: true,
      recovery: "RECONCILE_REQUIRED",
    };
    const c = {
      ...claim(),
      mode: "RECONCILE",
      attempt: unknown,
      auditLogId: id(16),
    };
    const event = {
      schemaVersion: 1,
      providerAccountId: id(1),
      environment: "TEST",
      providerEventId: "fake/reconcile/one",
      evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id(16) },
      occurredAt: now,
      association: {
        status: "MATCHED",
        paymentAttemptId: id(2),
        externalReference: "fake/payment/one",
      },
      eventType: "PAYMENT_STATUS",
      status: "PROCESSING",
      amountMinor: 500,
      currency: "USD",
    };
    const value = {
      schemaVersion: 1,
      claim: c,
      providerEventId: id(19),
      associationId: id(20),
      eventId: id(21),
      outboxEventId: id(22),
      receiptId: id(23),
      retryAfterMs: 5000,
      event,
    };
    const resumed = {
      ...value,
      event: { ...event, status: "REQUIRES_ACTION" },
      action,
    };
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse(resumed).success,
    ).toBe(true);
    const expired = {
      ...resumed,
      claim: {
        ...c,
        attempt: {
          ...unknown,
          status: "REQUIRES_ACTION",
          action,
          actionExpired: true,
          externalReference: "fake/payment/one",
        },
      },
    };
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse(expired).success,
    ).toBe(true);
    for (const changes of [
      { actionExpired: false },
      { recovery: "NONE" },
      { recovery: "EVIDENCE_PENDING" },
      { status: "PROCESSING" },
    ]) {
      expect(
        paymentRuntimeRecordReconcileCommandSchema.safeParse({
          ...expired,
          claim: {
            ...expired.claim,
            attempt: { ...expired.claim.attempt, ...changes },
          },
        }).success,
      ).toBe(false);
    }

    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...resumed,
        event,
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...resumed,
        action: { schemaVersion: 1, type: "WAIT", pollAfterMs: 1000 },
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...resumed,
        claim: { ...c, supportedActionTypes: ["QR_CODE"] },
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse(value).success,
    ).toBe(true);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...value,
        event: { ...event, amountMinor: 501 },
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...value,
        event: {
          ...event,
          evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id(99) },
        },
      }).success,
    ).toBe(false);
    expect(
      paymentRuntimeRecordReconcileCommandSchema.safeParse({
        ...value,
        event: {
          ...event,
          evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: id(24) },
        },
      }).success,
    ).toBe(false);
  });
});
