import { expect, test, vi } from "vitest";
import {
  paymentRuntimeClaimRecoveryCommandSchema,
  paymentRuntimeClaimSchema,
  paymentRuntimeBeginCreateCommandSchema,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { claimPaymentRecovery } from "./payment-runtime-recovery.js";
import { requirePaymentClaim } from "./payment-runtime-fence.js";
import { beginPaymentCreate } from "./payment-runtime-write.js";
import type { TransactionClient } from "./transaction-runner.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-09T00:00:00.000001Z",
  later = "2026-09-09T00:10:00.000001Z",
  digest = "a".repeat(64);
const create = {
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
const operation = {
  id: id(8),
  attempt_id: id(2),
  phase: "CREATE",
  generation: 2,
  lease_digest: digest,
  lease_until: later,
  create_command: create,
  supported_action_types: ["REDIRECT"],
  audit_log_id: null,
  request_id: id(9),
  correlation_id: id(10),
  task_name: "payment-runtime",
};
const attempt = {
  id: id(2),
  cart_id: id(4),
  checkout_session_id: id(5),
  order_id: id(3),
  provider_account_id: id(1),
  adapter_key: "fake",
  environment: "TEST",
  payment_method: "fake_card",
  amount_minor: "500",
  market: "US",
  currency: "USD",
  requested_locale: "ja",
  provider_locale: "en",
  provider_locale_fallback_used: true,
  config_version_id: id(6),
  config_version: "1",
  route_rule_id: id(7),
  rule_version: "1",
  merchant_reference: id(2),
  provider_idempotency_key: id(2),
  external_reference: null,
  status: "CREATED",
  version: "1",
  provider_call_started: false,
  action_type: null,
  phase: "CREATE",
  can_retry: false,
  action_expired: false,
  created_at: at,
  updated_at: at,
};
const recovery = paymentRuntimeClaimRecoveryCommandSchema.parse({
  schemaVersion: 1,
  target: { kind: "DUE" },
  leaseTokenDigest: digest,
  leaseDurationMs: 30000,
  requestId: id(9),
  correlationId: id(10),
  taskName: "payment-runtime",
  auditLogId: id(16),
});
function setup(sequence: unknown[][]) {
  const query = vi.fn(async (...args: [string, unknown[]?]) => {
    void args;
    return { rows: sequence.shift() ?? [] };
  });
  const append = vi.fn(async (command: { event: { eventId: string } }) => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "APPEND_OUTBOX_EVENT",
    value: { eventId: command.event.eventId },
  }));
  return {
    query,
    client: { query, release: vi.fn() } as TransactionClient,
    append,
    outbox: { append } as unknown as OutboxRepository,
  };
}
test("CREATED recovery replays only the exact persisted create while original resources remain valid", async () => {
  const h = setup([
    [{ id: id(8) }],
    [],
    [operation],
    [attempt],
    [],
    [],
    [
      {
        resources_valid: true,
        order_status: "PENDING_PAYMENT",
        payment_status: "PENDING",
      },
    ],
  ]);
  const result = await claimPaymentRecovery(h.client, h.outbox, recovery);
  expect(result?.mode).toBe("CREATE");
  expect(result?.createCommand).toEqual(create);
  expect(result?.supportedActionTypes).toEqual(["REDIRECT"]);
  expect(h.append).not.toHaveBeenCalled();
});
test("expired original resources turn a dispatched CREATED into UNKNOWN and reconcile without authorizing create", async () => {
  const updated = {
    ...attempt,
    status: "UNKNOWN",
    version: "2",
    provider_call_started: true,
    phase: "RECONCILE",
  };
  const h = setup([
    [{ id: id(8) }],
    [],
    [operation],
    [attempt],
    [],
    [],
    [
      {
        resources_valid: false,
        order_status: "PENDING_PAYMENT",
        payment_status: "PENDING",
      },
    ],
    [{ event_time: at }],
    [],
    [],
    [],
    [{ ...operation, phase: "RECONCILE", audit_log_id: id(16) }],
    [updated],
  ]);
  const result = await claimPaymentRecovery(h.client, h.outbox, recovery);
  expect(result?.mode).toBe("RECONCILE");
  expect(result?.attempt.status).toBe("UNKNOWN");
  expect(result?.attempt.externalReference).toBeNull();
  expect(result?.createCommand).toEqual(create);
  expect(h.append).toHaveBeenCalledTimes(1);
  expect(h.append.mock.calls[0]?.[0]).toMatchObject({
    event: { payload: { status: "UNKNOWN" } },
  });
  expect(
    h.query.mock.calls.some(
      ([sql]) =>
        sql.includes("status='UNKNOWN'") &&
        sql.includes("'NETWORK_UNCERTAINTY'"),
    ),
  ).toBe(true);
  expect(
    h.query.mock.calls.some(
      ([sql]) =>
        sql.includes("INSERT INTO public.orders") ||
        sql.includes("INSERT INTO public.inventory_reservations"),
    ),
  ).toBe(false);
});
test("a stale or expired lease is rejected before any attempt state write", async () => {
  const h = setup([[]]);
  const claim = paymentRuntimeClaimSchema.parse({
    schemaVersion: 1,
    operationId: id(8),
    generation: 2,
    leaseTokenDigest: digest,
    leaseExpiresAt: later,
    mode: "CREATE",
    attempt: {
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
      createdAt: at,
      updatedAt: at,
    },
    createCommand: create,
    auditLogId: null,
    supportedActionTypes: ["REDIRECT"],
    requestId: id(9),
    correlationId: id(10),
    taskName: "payment-runtime",
  });
  await expect(requirePaymentClaim(h.client, claim)).rejects.toMatchObject({
    code: "STALE_CLAIM",
  });
  expect(h.query).toHaveBeenCalledTimes(1);
});
test.each([
  ["a", "STALE_CLAIM"],
  ["b", "IDEMPOTENCY_CONFLICT"],
])(
  "same-key race never redispatches a stored receipt (%s)",
  async (hash, code) => {
    const receipt = {
      schemaVersion: 1,
      receiptId: id(11),
      operationId: id(8),
      cartId: id(4),
      checkoutSessionId: id(5),
      attemptId: id(2),
      idempotencyKey: "payment-create-test-0001",
      canonicalRequestHash: hash.repeat(64),
      occurredAt: at,
    };
    const h = setup([
      [
        {
          id: id(4),
          version: "4",
          status: "LOCKED",
          expired: false,
          presentation_locale: "ja",
          market: "US",
          currency: "USD",
          created_at: at,
          updated_at: at,
          expires_at: later,
        },
      ],
      [{ receipt }],
    ]);
    const command = paymentRuntimeBeginCreateCommandSchema.parse({
      schemaVersion: 1,
      accesses: [
        { schemaVersion: 1, tokenDigest: digest, pepperVersion: "v1" },
      ],
      checkoutSessionId: id(5),
      expectedOrderVersion: 2,
      receiptId: id(11),
      operationId: id(8),
      attemptId: id(2),
      idempotencyKey: receipt.idempotencyKey,
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
      createCommand: create,
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
    });
    await expect(
      beginPaymentCreate(h.client, h.outbox, command),
    ).rejects.toMatchObject({ code });
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.append).not.toHaveBeenCalled();
  },
);
