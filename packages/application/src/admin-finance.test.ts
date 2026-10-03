import { expect, test, vi } from "vitest";
import * as application from "./index.js";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import type { AdminFinanceRepository } from "@fan-support/persistence-port";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  eventId = "10000000-0000-4000-8000-000000000003";
const token = "a".repeat(42) + "A",
  csrf = "b".repeat(42) + "A";
const command = {
  schemaVersion: 1,
  action: "REFUND",
  orderId: id,
  expectedOrderVersion: 2,
  idempotencyKey: "refund-test-0001",
  reasonCode: "CUSTOMER_REQUEST",
  confirmed: true,
  currency: "USD",
  amountMinor: 100,
  allocations: [{ orderItemId: other, amountMinor: 100 }],
} as const;
const request = (value: unknown = command) => ({
  schemaVersion: 1,
  requestId: id,
  sessionToken: token,
  csrfToken: csrf,
  command: value,
});
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  orderId: id,
  operationId: other,
  refundId: other,
  replayed: false,
};
const providerCommand = {
  schemaVersion: 1,
  operation: "REFUND_PAYMENT",
  providerAccountId: id,
  environment: "TEST",
  refundId: other,
  paymentAttemptId: id,
  externalReference: "test-payment/one",
  refundReference: "refund/one",
  amountMinor: 100,
  currency: "USD",
  idempotencyKey: other,
} as const;
const claim = {
  schemaVersion: 1,
  requestId: id,
  correlationId: id,
  operationId: other,
  orderId: id,
  refundId: other,
  generation: 1,
  leaseTokenDigest: "a".repeat(64),
  leaseExpiresAt: "2026-09-22T10:00:00Z",
  adapterKey: "fake",
  auditLogId: null,
  command: providerCommand,
} as const;
const accepted = {
  schemaVersion: 1,
  operation: "REFUND_PAYMENT",
  outcome: "SUCCESS",
  value: {
    providerAccountId: id,
    environment: "TEST",
    refundId: other,
    paymentAttemptId: id,
    status: "PROCESSING",
    refundReference: "refund/one",
    amountMinor: 100,
    currency: "USD",
    observedAt: "2026-09-22T09:00:00Z",
  },
};
const queried = {
  schemaVersion: 1,
  operation: "RECONCILE_REFUND",
  outcome: "SUCCESS",
  value: {
    refundId: other,
    idempotencyKey: other,
    event: {
      schemaVersion: 1,
      providerAccountId: id,
      environment: "TEST",
      providerEventId: "refund-event/one",
      evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: eventId },
      occurredAt: "2026-09-22T09:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: id,
        externalReference: "test-payment/one",
      },
      eventType: "REFUND_STATUS",
      refundReference: "refund/one",
      status: "SUCCEEDED",
      amountMinor: 100,
      currency: "USD",
      transaction: { type: "REFUND", providerReference: "native/refund/one" },
    },
  },
};
function setup() {
  let inside = false;
  const execute = vi.fn(async (): Promise<unknown> => mutation),
    claimNext = vi.fn(async (): Promise<unknown> => null),
    settle = vi.fn<(command: unknown) => Promise<unknown>>(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operationId: other,
      decision: "RECORDED",
      providerEventId: null,
    })),
    apply = vi.fn(async (): Promise<unknown> => ({
      schemaVersion: 1,
      providerEventId: eventId,
      decision: "APPLIED",
      orderId: id,
      reasonCode: "REFUND_CONFIRMED",
    })),
    listPending = vi.fn(async (): Promise<unknown> => ({
      schemaVersion: 1,
      providerEventIds: [eventId],
    }));
  const repository = {
    execute,
    claim: claimNext,
    settle,
    apply,
    listPending,
  } as unknown as AdminFinanceRepository;
  const run = vi.fn(
    async (work: (r: AdminFinanceRepository) => Promise<unknown>) => {
      expect(inside).toBe(false);
      inside = true;
      try {
        return await work(repository);
      } finally {
        inside = false;
      }
    },
  );
  const refundPayment = vi.fn(async (): Promise<unknown> => {
    expect(inside, "PSP outside PG transaction").toBe(false);
    return accepted;
  });
  const reconcileRefund = vi.fn(async (): Promise<unknown> => {
    expect(inside).toBe(false);
    return queried;
  });
  const provider = {
    getCapabilities: vi.fn(),
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    cancelPayment: vi.fn(),
    refundPayment,
    reconcilePayment: vi.fn(),
    reconcileRefund,
  };
  const config = {
    schemaVersion: 1,
    providerAccountId: id,
    providerCode: "fake",
    environment: "TEST",
    allowedActionOrigins: ["https://payments.example.invalid"],
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((l) => [
        l,
        { providerLocale: l, fallbackUsed: false },
      ]),
    ),
  };
  type Factory = (deps: unknown) => {
    execute(input: unknown): Promise<unknown>;
    recoverNext(): Promise<unknown>;
    runPending(limit: number): Promise<unknown>;
  };
  const factory = (application as unknown as Record<string, Factory>)[
    "createAdminFinanceUseCases"
  ];
  expect(factory).toBeTypeOf("function");
  const deps = {
    transactions: { runInAdminFinanceTransaction: run },
    tokenPepper: "a".repeat(64),
    providers: [{ configuration: config, provider }],
    leaseMs: 2000,
    retryAfterMs: 1000,
  };
  return {
    useCases: factory!(deps),
    factory: factory!,
    deps,
    execute,
    claimNext,
    settle,
    apply,
    listPending,
    run,
    refundPayment,
    reconcileRefund,
  };
}
test("finance requests use digests and a committed receipt before provider work", async () => {
  const h = setup();
  h.claimNext.mockResolvedValueOnce(claim).mockResolvedValueOnce({
    ...claim,
    generation: 2,
    auditLogId: eventId,
    command: {
      ...providerCommand,
      operation: "RECONCILE_REFUND",
      auditLogId: eventId,
    },
  });
  h.settle
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operationId: other,
      decision: "RECORDED",
      providerEventId: null,
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operationId: other,
      decision: "COMPLETE",
      providerEventId: eventId,
    });
  expect(await h.useCases.execute(request())).toEqual(mutation);
  expect(h.refundPayment).toHaveBeenCalledTimes(1);
  expect(h.reconcileRefund).toHaveBeenCalledTimes(1);
  expect(h.apply).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(h.execute.mock.calls)).not.toContain(token);
  expect(JSON.stringify(h.execute.mock.calls)).not.toContain(csrf);
  expect(h.execute.mock.invocationCallOrder[0]).toBeLessThan(
    h.refundPayment.mock.invocationCallOrder[0]!,
  );
});
test("replayed receipt and forbidden requests never submit another refund", async () => {
  const h = setup();
  h.execute.mockResolvedValueOnce({ ...mutation, replayed: true });
  expect(await h.useCases.execute(request())).toEqual({
    ...mutation,
    replayed: true,
  });
  h.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  });
  await h.useCases.execute(request());
  expect(h.claimNext).not.toHaveBeenCalled();
  expect(h.refundPayment).not.toHaveBeenCalled();
});
test("uncertain refund preserves durable acceptance and recovery queries its original identity", async () => {
  const h = setup();
  h.claimNext.mockResolvedValueOnce(claim);
  h.refundPayment.mockRejectedValueOnce(
    new Error("private provider exception"),
  );
  expect(await h.useCases.execute(request())).toEqual(mutation);
  expect(h.settle.mock.calls[0]?.[0]).toMatchObject({
    result: { kind: "UNCERTAIN", reasonCode: "PROVIDER_NETWORK_UNCERTAINTY" },
  });
  h.claimNext.mockResolvedValueOnce({
    ...claim,
    generation: 2,
    auditLogId: eventId,
    command: {
      ...providerCommand,
      operation: "RECONCILE_REFUND",
      auditLogId: eventId,
    },
  });
  await h.useCases.recoverNext();
  expect(h.refundPayment).toHaveBeenCalledTimes(1);
  expect(h.reconcileRefund).toHaveBeenCalledTimes(1);
});
test("mismatched provider output cannot become financial evidence", async () => {
  const h = setup();
  h.claimNext.mockResolvedValueOnce(claim);
  h.refundPayment.mockResolvedValueOnce({
    ...accepted,
    value: { ...accepted.value, amountMinor: 101 },
  });
  await h.useCases.execute(request());
  expect(h.settle.mock.calls[0]?.[0]).toMatchObject({
    result: { kind: "UNCERTAIN", reasonCode: "PROVIDER_RESPONSE_INVALID" },
  });
  expect(h.apply).not.toHaveBeenCalled();
});
test("a refund still unresolved after provider work raises the alert hook (audit PAY-04)", async () => {
  const h = setup();
  const onRefundUnresolved = vi.fn(() => {
    throw new Error("alert sink unavailable");
  });
  const useCases = h.factory({ ...h.deps, onRefundUnresolved });
  const deferred = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    operationId: other,
    decision: "DEFERRED",
    providerEventId: null,
  };
  h.claimNext.mockResolvedValueOnce(claim);
  h.refundPayment.mockRejectedValueOnce(new Error("network"));
  h.settle.mockResolvedValueOnce(deferred);
  expect(await useCases.recoverNext()).toMatchObject({ processed: true });
  expect(onRefundUnresolved).toHaveBeenCalledTimes(1);
  h.claimNext.mockResolvedValueOnce(claim);
  await useCases.recoverNext();
  expect(onRefundUnresolved).toHaveBeenCalledTimes(1);
});
test("missing frozen provider records a bounded deferral and never routes to a replacement", async () => {
  const h = setup();
  h.claimNext.mockResolvedValueOnce({ ...claim, adapterKey: "different" });
  await h.useCases.recoverNext();
  expect(h.refundPayment).not.toHaveBeenCalled();
  expect(h.settle.mock.calls[0]?.[0]).toMatchObject({
    result: { kind: "UNCERTAIN", reasonCode: "PROVIDER_UNAVAILABLE" },
  });
});
test("pending evidence uses independently committed applications and reports failures", async () => {
  const h = setup();
  expect(await h.useCases.runPending(10)).toMatchObject({
    scanned: 1,
    applied: 1,
    failed: 0,
  });
  h.apply.mockRejectedValueOnce(new Error("SQL private"));
  expect(await h.useCases.runPending(10)).toMatchObject({
    scanned: 1,
    failed: 1,
  });
});
test("invalid authority and mismatched repository responses fail closed", async () => {
  const h = setup();
  expect(await h.useCases.execute({ ...request(), actorId: id })).toMatchObject(
    { code: "INVALID_COMMAND" },
  );
  expect(h.run).not.toHaveBeenCalled();
  h.execute.mockResolvedValueOnce({ ...mutation, orderId: other });
  expect(await h.useCases.execute(request())).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.claimNext).not.toHaveBeenCalled();
});
test("a failed settle commit does not disguise a durable mutation as failure or resubmit", async () => {
  const h = setup();
  h.claimNext.mockResolvedValueOnce(claim);
  h.settle.mockRejectedValueOnce(new Error("commit confirmation lost"));
  expect(await h.useCases.execute(request())).toEqual(mutation);
  expect(h.refundPayment).toHaveBeenCalledTimes(1);
  expect(h.claimNext).toHaveBeenCalledTimes(1);
});
test("financial receipts retain the requested refund target before any recovery dispatch", async () => {
  const h = setup();
  h.execute.mockResolvedValueOnce({ ...mutation, refundId: null });
  expect(await h.useCases.execute(request())).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  h.execute.mockResolvedValueOnce({ ...mutation, refundId: eventId });
  expect(
    await h.useCases.execute(
      request({
        schemaVersion: 1,
        action: "RECONCILE",
        orderId: id,
        expectedOrderVersion: 2,
        idempotencyKey: "reconcile-test-01",
        reasonCode: "CUSTOMER_REQUEST",
        confirmed: true,
        target: { kind: "REFUND", refundId: other },
      }),
    ),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  expect(h.claimNext).not.toHaveBeenCalled();
});
