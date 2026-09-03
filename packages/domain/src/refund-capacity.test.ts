import { describe, expect, test } from "vitest";
import { refundCapacityDecisionSchema } from "@fan-support/contracts";

import { evaluateRefundCapacity } from "./refund-capacity.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PAYMENT_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_REFUND_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PAYMENT_ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";
const PROVIDER_ACCOUNT_ID = "77777777-7777-4777-8777-777777777777";

function order(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: ORDER_ID,
    version: 7,
    orderStatus: "OPEN",
    paymentStatus: "PAID",
    currentPaymentAttemptId: PAYMENT_ATTEMPT_ID,
    ...overrides,
  };
}

function capturedPaymentAttempt(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: 1,
    id: PAYMENT_ATTEMPT_ID,
    orderId: ORDER_ID,
    version: 3,
    status: "SUCCEEDED",
    providerAccountId: PROVIDER_ACCOUNT_ID,
    environment: "TEST",
    externalReference: "pay_1",
    amountMinor: 10_000,
    currency: "USD",
    providerCallStarted: true,
    ...overrides,
  };
}

function refundSubject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: CURRENT_REFUND_ID,
    orderId: ORDER_ID,
    paymentAttemptId: PAYMENT_ATTEMPT_ID,
    version: 5,
    status: "REQUESTED",
    providerReference: "refund_current",
    capturedCurrency: "USD",
    capturedAmountMinor: 10_000,
    requestedAmountMinor: 1_000,
    currency: "USD",
    ...overrides,
  };
}

function refundRecord(
  id: string,
  status: string,
  requestedAmountMinor: number,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: 1,
    id,
    orderId: ORDER_ID,
    paymentAttemptId: PAYMENT_ATTEMPT_ID,
    version: 4,
    status,
    providerReference: `refund_${id.slice(0, 8)}`,
    capturedCurrency: "USD",
    capturedAmountMinor: 10_000,
    requestedAmountMinor,
    currency: "USD",
    processedAmountMinor: status === "SUCCEEDED" ? requestedAmountMinor : 0,
    ...overrides,
  };
}

function recordFor(subject: ReturnType<typeof refundSubject>) {
  return { ...subject, processedAmountMinor: 0 };
}

function capacityInput(
  subject: ReturnType<typeof refundSubject> = refundSubject(),
  otherRefunds: readonly ReturnType<typeof refundRecord>[] = [],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: 1,
    order: order(),
    paymentAttempt: capturedPaymentAttempt(),
    refund: subject,
    refunds: [recordFor(subject), ...otherRefunds],
    ...overrides,
  };
}

describe("refund capacity", () => {
  test("counts the current, successful, and UNKNOWN refunds against capture", () => {
    const subject = refundSubject({ requestedAmountMinor: 2_001 });
    expect(
      evaluateRefundCapacity(
        capacityInput(subject, [
          refundRecord(
            "44444444-4444-4444-8444-444444444444",
            "SUCCEEDED",
            3_000,
          ),
          refundRecord(
            "55555555-5555-4555-8555-555555555555",
            "UNKNOWN",
            5_000,
          ),
        ]),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "REFUND_CAPACITY_EXCEEDED",
      refundId: CURRENT_REFUND_ID,
      orderId: ORDER_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      refundExpectedVersion: 5,
      orderExpectedVersion: 7,
      paymentAttemptExpectedVersion: 3,
      occupiedAmountMinor: 10_001,
      availableAmountMinor: 0,
    });
  });

  test("FAILED refunds release capacity and returns persistence predicates", () => {
    const subject = refundSubject({ requestedAmountMinor: 7_000 });
    const decision = evaluateRefundCapacity(
      capacityInput(subject, [
        refundRecord("44444444-4444-4444-8444-444444444444", "FAILED", 9_000),
        refundRecord(
          "55555555-5555-4555-8555-555555555555",
          "SUCCEEDED",
          3_000,
        ),
      ]),
    );
    expect(decision).toMatchObject({
      schemaVersion: 1,
      kind: "AVAILABLE",
      refundId: CURRENT_REFUND_ID,
      orderId: ORDER_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      refundExpectedVersion: 5,
      orderExpectedVersion: 7,
      paymentAttemptExpectedVersion: 3,
      capturedCurrency: "USD",
      capturedAmountMinor: 10_000,
      requestedCurrency: "USD",
      requestedAmountMinor: 7_000,
      occupiedAmountMinor: 10_000,
      availableAmountMinor: 0,
    });
    expect(refundCapacityDecisionSchema.safeParse(decision).success).toBe(true);
  });

  test("rejects zero-value and cross-currency requests", () => {
    expect(
      evaluateRefundCapacity(
        capacityInput(refundSubject({ requestedAmountMinor: 0 })),
      ),
    ).toMatchObject({ kind: "REJECTED", code: "REFUND_AMOUNT_INVALID" });
    expect(
      evaluateRefundCapacity(capacityInput(refundSubject({ currency: "EUR" }))),
    ).toMatchObject({
      kind: "REJECTED",
      code: "REFUND_CURRENCY_MISMATCH",
    });
  });

  test("rejects a cross-currency record anywhere in the complete refund set", () => {
    const decision = evaluateRefundCapacity(
      capacityInput(refundSubject(), [
        refundRecord("44444444-4444-4444-8444-444444444444", "UNKNOWN", 500, {
          currency: "EUR",
        }),
      ]),
    );

    expect(decision).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "REFUND_DATA_INVALID",
    });
    expect(refundCapacityDecisionSchema.safeParse(decision).success).toBe(true);
  });

  test("requires the order's current captured SUCCEEDED attempt", () => {
    const valid = capacityInput();
    const unboundAttempt = {
      ...capturedPaymentAttempt(),
      externalReference: undefined,
    };
    for (const invalid of [
      {
        ...valid,
        order: order({ currentPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID }),
      },
      {
        ...valid,
        paymentAttempt: capturedPaymentAttempt({ status: "FAILED" }),
      },
      { ...valid, paymentAttempt: unboundAttempt },
      {
        schemaVersion: 1,
        paymentAttemptId: PAYMENT_ATTEMPT_ID,
        capturedCurrency: "USD",
        capturedAmountMinor: 10_000,
        requestedCurrency: "USD",
        requestedAmountMinor: 1,
        existingRefunds: [],
      },
    ]) {
      expect(evaluateRefundCapacity(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "REFUND_DATA_INVALID",
      });
    }
  });

  test("requires exactly one current refund in the complete versioned set", () => {
    const valid = capacityInput();
    for (const invalid of [
      { ...valid, refunds: [] },
      { ...valid, refunds: [...valid.refunds, valid.refunds[0]] },
      {
        ...valid,
        refunds: [{ ...valid.refunds[0], version: 4 }],
      },
    ]) {
      expect(evaluateRefundCapacity(invalid)).toMatchObject({
        kind: "REJECTED",
        code: "REFUND_DATA_INVALID",
      });
    }
  });

  test("rejects records from another order or payment attempt", () => {
    for (const invalidRefund of [
      refundRecord("44444444-4444-4444-8444-444444444444", "UNKNOWN", 1_000, {
        paymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
      }),
      refundRecord("44444444-4444-4444-8444-444444444444", "UNKNOWN", 1_000, {
        orderId: "88888888-8888-4888-8888-888888888888",
      }),
    ]) {
      expect(
        evaluateRefundCapacity(capacityInput(refundSubject(), [invalidRefund])),
      ).toMatchObject({ kind: "REJECTED", code: "REFUND_DATA_INVALID" });
    }
  });

  test("does not release capacity for a FAILED refund with a processed amount", () => {
    expect(
      evaluateRefundCapacity(
        capacityInput(refundSubject(), [
          refundRecord(
            "44444444-4444-4444-8444-444444444444",
            "FAILED",
            9_000,
            { processedAmountMinor: 1_000 },
          ),
        ]),
      ),
    ).toMatchObject({ kind: "REJECTED", code: "REFUND_DATA_INVALID" });
  });

  test("rejects aggregate over-capacity without releasing UNKNOWN amounts", () => {
    expect(
      evaluateRefundCapacity(
        capacityInput(refundSubject(), [
          refundRecord(
            "44444444-4444-4444-8444-444444444444",
            "UNKNOWN",
            6_000,
          ),
          refundRecord(
            "55555555-5555-4555-8555-555555555555",
            "UNKNOWN",
            6_000,
          ),
        ]),
      ),
    ).toMatchObject({
      kind: "REJECTED",
      code: "REFUND_CAPACITY_EXCEEDED",
      occupiedAmountMinor: 13_000,
      availableAmountMinor: 0,
    });
  });

  test("rejects malformed, unknown, and non-v1 capacity inputs", () => {
    const valid = capacityInput();
    for (const invalid of [
      null,
      { ...valid, schemaVersion: 2 },
      { ...valid, unknown: true },
      {
        order: valid.order,
        paymentAttempt: valid.paymentAttempt,
        refund: valid.refund,
        refunds: valid.refunds,
      },
    ]) {
      expect(evaluateRefundCapacity(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "REFUND_DATA_INVALID",
      });
    }
  });
});
