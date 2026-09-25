import { describe, expect, it } from "vitest";
const api = await import("./admin-finance.js").catch(() => undefined);
const internal = await import("./admin-finance-persistence.js").catch(
  () => undefined,
);
const id = "10000000-0000-4000-8000-000000000001";
const itemId = "10000000-0000-4000-8000-000000000002";
const refund = {
  schemaVersion: 1,
  action: "REFUND",
  orderId: id,
  expectedOrderVersion: 1,
  idempotencyKey: "refund-command-0001",
  reasonCode: "CUSTOMER_REQUEST",
  confirmed: true,
  currency: "USD",
  amountMinor: 200,
  allocations: [{ orderItemId: itemId, amountMinor: 200 }],
};
describe("admin finance contracts", () => {
  it("limits finance dispatch to cancel, refund and authenticated reconciliation", () => {
    expect(
      internal!.adminFinanceProviderCommandSchema.options.map(
        (schema) => schema.shape.operation.value,
      ),
    ).toEqual([
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
      "RECONCILE_PAYMENT",
      "RECONCILE_REFUND",
    ]);
  });
  it("defines strict financial commands with explicit authority guards", () => {
    expect(api?.adminFinanceCommandSchema).toBeDefined();
    const schema = api!.adminFinanceCommandSchema;
    expect(schema.safeParse(refund).success).toBe(true);
    for (const patch of [
      { confirmed: false },
      { expectedOrderVersion: 0 },
      { reasonCode: "" },
      { amountMinor: 0 },
      { amountMinor: 1.2 },
      { amountMinor: 201 },
      {
        allocations: [
          { orderItemId: itemId, amountMinor: 100 },
          { orderItemId: itemId, amountMinor: 100 },
        ],
      },
      { providerAccountId: id },
      { currency: "usd" },
    ])
      expect(schema.safeParse({ ...refund, ...patch }).success).toBe(false);
  });
  it("exposes reconcile identities and no client-written dispute outcome", () => {
    expect(api?.adminFinanceCommandSchema).toBeDefined();
    const schema = api!.adminFinanceCommandSchema;
    const common = {
      schemaVersion: 1,
      orderId: refund.orderId,
      expectedOrderVersion: refund.expectedOrderVersion,
      idempotencyKey: refund.idempotencyKey,
      reasonCode: refund.reasonCode,
      confirmed: true,
    };
    expect(schema.safeParse({ ...common, action: "CANCEL" }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        ...common,
        action: "RECONCILE",
        target: { kind: "REFUND", refundId: id },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...common,
        action: "RECONCILE",
        target: { kind: "PAYMENT", attemptId: id },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...common, action: "DISPUTE", status: "WON" }).success,
    ).toBe(false);
  });
  it("rejects mismatched provider claims before adapters can send money", () => {
    expect(internal?.adminFinanceClaimSchema).toBeDefined();
    const claim = {
      schemaVersion: 1,
      operationId: id,
      orderId: id,
      refundId: itemId,
      generation: 1,
      leaseTokenDigest: "a".repeat(64),
      leaseExpiresAt: "2026-09-22T00:00:00.000Z",
      adapterKey: "test-provider",
      requestId: id,
      correlationId: id,
      auditLogId: null,
      command: {
        schemaVersion: 1,
        operation: "REFUND_PAYMENT",
        providerAccountId: id,
        environment: "TEST",
        refundId: itemId,
        paymentAttemptId: id,
        externalReference: "test-payment-001",
        refundReference: itemId,
        amountMinor: 200,
        currency: "USD",
        idempotencyKey: itemId,
      },
    };
    expect(internal!.adminFinanceClaimSchema.safeParse(claim).success).toBe(
      true,
    );
    expect(
      internal!.adminFinanceClaimSchema.safeParse({ ...claim, refundId: id })
        .success,
    ).toBe(false);
    expect(
      internal!.adminFinanceClaimSchema.safeParse({
        ...claim,
        command: { ...claim.command, operation: "GET_PAYMENT" },
      }).success,
    ).toBe(false);
  });
});

it("carries an explicit dispute hold without exposing provider internals", () => {
  expect(
    api?.adminFinanceFailureSchema.safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "DISPUTE_REQUIRES_REVIEW",
    }).success,
  ).toBe(true);
});
