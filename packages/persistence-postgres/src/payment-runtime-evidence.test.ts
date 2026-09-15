import { expect, test, vi } from "vitest";
import {
  paymentRuntimeRecordReconcileCommandSchema,
  type PaymentRuntimeRecordReconcileCommand,
} from "@fan-support/contracts";
import type { TransactionClient } from "./transaction-runner.js";

const loaded = (await import("./payment-runtime-evidence.js").catch(
  () => ({}),
)) as {
  persistPaymentRuntimeEvidence?: (
    client: TransactionClient,
    command: PaymentRuntimeRecordReconcileCommand,
    recordedAt: string,
  ) => Promise<{ providerEventId: string; auditLogId: string }>;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const occurredAt = "2026-09-09T00:00:00.001Z";
const recordedAt = "2026-09-09T00:00:00.001234Z";
function command(withTransaction = true) {
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
    externalReference: "provider-payment-test",
    status: "UNKNOWN",
    version: 2,
    providerCallStarted: true,
    action: null,
    recovery: "RECONCILE_REQUIRED",
    canRetry: false,
    actionExpired: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  return paymentRuntimeRecordReconcileCommandSchema.parse({
    schemaVersion: 1,
    claim: {
      schemaVersion: 1,
      operationId: id(9),
      generation: 2,
      leaseTokenDigest: "a".repeat(64),
      leaseExpiresAt: "2026-09-09T00:01:00.000000Z",
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
      providerAccountId: id(6),
      environment: "TEST",
      providerEventId: "provider-event-test",
      evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id(10) },
      occurredAt,
      association: {
        status: "MATCHED",
        paymentAttemptId: id(2),
        externalReference: "provider-payment-test",
      },
      eventType: "PAYMENT_STATUS",
      status: "SUCCEEDED",
      amountMinor: 1500,
      currency: "USD",
      ...(withTransaction
        ? {
            transaction: {
              type: "CAPTURE",
              providerReference: "provider-capture-test",
            },
          }
        : {}),
    },
  });
}
function setup(existing: unknown[] = []) {
  expect(loaded.persistPaymentRuntimeEvidence).toBeTypeOf("function");
  const query = vi.fn<TransactionClient["query"]>(async (sql, values) => ({
    rows: sql.includes("SELECT") ? existing : [{ id: values?.[0] }],
  }));
  const client: TransactionClient = { query, release: vi.fn() };
  return {
    query,
    persist: (input = command()) =>
      loaded.persistPaymentRuntimeEvidence!(client, input, recordedAt),
  };
}
test("new reconcile evidence persists audit, exact event/association and capture ledger without changing payment or order", async () => {
  const { query, persist } = setup();
  await expect(persist()).resolves.toEqual({
    providerEventId: id(13),
    auditLogId: id(10),
  });
  const inserts = query.mock.calls.filter(([sql]) => sql.includes("INSERT"));
  expect(inserts).toHaveLength(4);
  expect(
    inserts.map(([sql]) => /INSERT INTO public\.(\w+)/u.exec(sql)?.[1]),
  ).toEqual([
    "audit_logs",
    "provider_events",
    "provider_event_associations",
    "payment_transactions",
  ]);
  expect(inserts[0]![1]).toEqual([
    id(10),
    "payment-runtime",
    id(6),
    id(11),
    id(12),
    recordedAt,
  ]);
  expect(inserts[1]![1]).toEqual([
    id(13),
    id(6),
    "TEST",
    "provider-event-test",
    id(10),
    "SUCCEEDED",
    "provider-payment-test",
    "CAPTURE",
    "provider-capture-test",
    1500,
    "USD",
    occurredAt,
    recordedAt,
  ]);
  expect(inserts[2]![1]).toEqual([id(14), id(13), id(2), recordedAt]);
  expect(inserts[3]![1]?.slice(1)).toEqual([
    id(2),
    "CAPTURE",
    "provider-capture-test",
    1500,
    "USD",
    id(13),
    id(10),
    occurredAt,
    recordedAt,
  ]);
  expect(
    query.mock.calls.every(
      ([sql]) => !/\b(?:UPDATE|DELETE|BEGIN|COMMIT)\b/u.test(sql),
    ),
  ).toBe(true);
});
test("a status observation without a financial transaction does not invent a ledger row", async () => {
  const { query, persist } = setup();
  await persist(command(false));
  expect(
    query.mock.calls.filter(([sql]) => sql.includes("INSERT")),
  ).toHaveLength(3);
});
test("same provider event reuses the original authenticated audit and ledger without writing again", async () => {
  const { query, persist } = setup([
    { id: id(20), audit_log_id: id(21), matches: true },
  ]);
  await expect(persist()).resolves.toEqual({
    providerEventId: id(20),
    auditLogId: id(21),
  });
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, values] = query.mock.calls[0]!;
  expect(values).toEqual([
    id(6),
    "TEST",
    "provider-event-test",
    "SUCCEEDED",
    "provider-payment-test",
    "CAPTURE",
    "provider-capture-test",
    1500,
    "USD",
    occurredAt,
    id(2),
  ]);
  for (const boundary of [
    "PAYMENT_PROVIDER_RECONCILE",
    "PAYMENT_PROVIDER_ACCOUNT",
    "MATCHED",
    "payment_transactions",
    "occurred_at = $10::timestamptz",
  ])
    expect(sql).toContain(boundary);
});
test("replayed event with different facts or missing exact authenticated association/ledger is rejected", async () => {
  for (const existing of [
    [{ id: id(20), audit_log_id: id(21), matches: false }],
    [{ id: id(20), audit_log_id: null, matches: true }],
    [
      { id: id(20), audit_log_id: id(21), matches: true },
      { id: id(22), audit_log_id: id(23), matches: true },
    ],
  ]) {
    const { query, persist } = setup(existing);
    await expect(persist()).rejects.toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
    expect(query).toHaveBeenCalledTimes(1);
  }
});
test("untrusted event and claim mismatches fail before any database call", async () => {
  for (const patch of [
    { amountMinor: 1501 },
    { providerAccountId: id(99) },
    { evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id(99) } },
  ]) {
    const { query, persist } = setup();
    const input = command();
    await expect(
      persist({
        ...input,
        event: { ...input.event, ...patch },
      } as PaymentRuntimeRecordReconcileCommand),
    ).rejects.toMatchObject({ code: "CONTENT_UNAVAILABLE" });
    expect(query).not.toHaveBeenCalled();
  }
});

test("a database rejection escapes for the owning transaction to roll back, without later association or ledger writes", async () => {
  expect(loaded.persistPaymentRuntimeEvidence).toBeTypeOf("function");
  const rejected = { code: "23514" };
  const query = vi.fn<TransactionClient["query"]>(async (sql, values) => {
    if (sql.includes("INSERT INTO public.provider_events")) throw rejected;
    return { rows: sql.includes("SELECT") ? [] : [{ id: values?.[0] }] };
  });
  await expect(
    loaded.persistPaymentRuntimeEvidence!(
      { query, release: vi.fn() },
      command(),
      recordedAt,
    ),
  ).rejects.toBe(rejected);
  expect(query).toHaveBeenCalledTimes(4);
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.provider_event_associations"),
    ),
  ).toBe(false);
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.payment_transactions"),
    ),
  ).toBe(false);
});

test("invalid recording instants and incomplete database writes cannot claim persisted evidence", async () => {
  expect(loaded.persistPaymentRuntimeEvidence).toBeTypeOf("function");
  const query = vi.fn<TransactionClient["query"]>(async () => ({ rows: [] }));
  const client: TransactionClient = { query, release: vi.fn() };
  await expect(
    loaded.persistPaymentRuntimeEvidence!(client, command(), "invalid"),
  ).rejects.toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  expect(query).not.toHaveBeenCalled();
  await expect(
    loaded.persistPaymentRuntimeEvidence!(client, command(), recordedAt),
  ).rejects.toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  expect(query).toHaveBeenCalledTimes(3);
});
