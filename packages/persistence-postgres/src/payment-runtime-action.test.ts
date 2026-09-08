import { Buffer } from "node:buffer";
import type * as PaymentRuntimeData from "./payment-runtime-data.js";
import { expect, test, vi } from "vitest";
import { paymentRuntimeRecordReconcileCommandSchema } from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { recordPaymentReconcile } from "./payment-runtime-recovery.js";
import type { TransactionClient } from "./transaction-runner.js";
const mocks = vi.hoisted(() => ({ history: vi.fn(), insert: vi.fn() }));
vi.mock("./payment-runtime-fence.js", () => ({
  requirePaymentClaim: async (value: unknown, claim: unknown) => {
    void value;
    return claim;
  },
}));
vi.mock("./payment-runtime-evidence.js", () => ({
  persistPaymentRuntimeEvidence: async () => ({
    providerEventId: "00000000-0000-4000-8000-000000000013",
    auditLogId: "00000000-0000-4000-8000-000000000010",
  }),
}));
vi.mock("./payment-runtime-history.js", () => ({
  appendPaymentHistory: mocks.history,
  insertPaymentRow: mocks.insert,
}));
vi.mock("./payment-runtime-data.js", async (original) => ({
  ...(await original<typeof PaymentRuntimeData>()),
  paymentEventTime: async () => "2026-09-09T00:00:00.001234Z",
  loadPaymentAttempt: async () => ({ status: "REQUIRES_ACTION" }),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function command(withAction: boolean) {
  const attempt = {
    schemaVersion: 1,
    id: id(2),
    cartId: id(3),
    checkoutSessionId: id(4),
    orderId: id(5),
    providerAccountId: id(6),
    adapterKey: "fake",
    environment: "TEST",
    paymentMethod: "fake_card",
    amountMinor: 1500,
    market: "US",
    currency: "USD",
    requestedLocale: "ja",
    providerLocale: "en",
    providerLocaleFallbackUsed: true,
    configVersionId: id(7),
    configVersion: 1,
    routeRuleId: id(8),
    ruleVersion: 1,
    merchantReference: id(2),
    providerIdempotencyKey: id(2),
    externalReference: null,
    status: "UNKNOWN",
    version: 2,
    providerCallStarted: true,
    action: null,
    recovery: "RECONCILE_REQUIRED",
    canRetry: false,
    actionExpired: false,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
  return paymentRuntimeRecordReconcileCommandSchema.parse({
    schemaVersion: 1,
    claim: {
      schemaVersion: 1,
      operationId: id(9),
      generation: 2,
      leaseTokenDigest: "a".repeat(64),
      leaseExpiresAt: "2026-09-09T00:01:00.000Z",
      mode: "RECONCILE",
      attempt,
      createCommand: {
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        providerAccountId: id(6),
        environment: "TEST",
        attemptId: id(2),
        orderId: id(5),
        paymentMethod: "fake_card",
        amountMinor: 1500,
        currency: "USD",
        requestedLocale: "ja",
        merchantReference: id(2),
        providerIdempotencyKey: id(2),
        returnUrl: "https://store.example.test/ja/checkout/return",
        cancelUrl: "https://store.example.test/ja/checkout/return",
      },
      auditLogId: id(10),
      supportedActionTypes: ["REDIRECT"],
      requestId: id(11),
      correlationId: id(12),
      taskName: "payment-runtime",
    },
    retryAfterMs: 1000,
    providerEventId: id(13),
    associationId: id(14),
    eventId: id(15),
    outboxEventId: id(16),
    receiptId: id(17),
    event: {
      schemaVersion: 1,
      eventType: "PAYMENT_STATUS",
      providerAccountId: id(6),
      environment: "TEST",
      providerEventId: "actual-reconcile-action",
      evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id(10) },
      association: {
        status: "MATCHED",
        paymentAttemptId: id(2),
        externalReference: "provider-test-reference",
      },
      status: "REQUIRES_ACTION",
      amountMinor: 1500,
      currency: "USD",
      occurredAt: "2026-09-09T00:00:00.001Z",
    },
    ...(withAction
      ? {
          action: {
            schemaVersion: 1,
            type: "REDIRECT",
            ciphertext: `enc:v1:${"a".repeat(43)}`,
            encryptedDataKey: `enc:v1:${"b".repeat(43)}`,
            encryptionKeyVersion: "test-key-v1",
            expiresAt: "2026-09-09T00:10:00.000Z",
          },
        }
      : {}),
  });
}
test("authenticated UNKNOWN action recovery writes real encrypted action with evidence and history", async () => {
  mocks.history.mockClear();
  mocks.insert.mockClear();
  const query = vi.fn(async (...args: [string, unknown[]?]) => {
    void args;
    return { rows: [] };
  });
  await recordPaymentReconcile(
    { query, release: vi.fn() } as TransactionClient,
    {} as OutboxRepository,
    command(true),
  );
  const update = query.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE public.payment_attempts"),
  );
  expect(update).toBeDefined();
  expect(update?.[1]).toContain("REQUIRES_ACTION");
  expect(update?.[1]?.some(Buffer.isBuffer)).toBe(true);
  expect(mocks.history).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      fromStatus: "UNKNOWN",
      toStatus: "REQUIRES_ACTION",
      evidenceKind: "AUTHENTICATED_RECONCILE",
    }),
  );
});
test("an actionless reconcile cannot claim the customer action was recovered", async () => {
  mocks.history.mockClear();
  mocks.insert.mockClear();
  const query = vi.fn(async (...args: [string, unknown[]?]) => {
    void args;
    return { rows: [] };
  });
  await recordPaymentReconcile(
    { query, release: vi.fn() } as TransactionClient,
    {} as OutboxRepository,
    command(false),
  );
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("UPDATE public.payment_attempts"),
    ),
  ).toBe(false);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.insert).toHaveBeenCalledWith(
    expect.anything(),
    "payment_reconcile_receipts",
    expect.objectContaining({ disposition: "OBSERVED" }),
  );
});
