import { describe, expect, test } from "vitest";

import { providerEventSchema } from "@fan-support/contracts";

import {
  validateProviderEvidence,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import {
  decideOrderLifecycleTransition,
  decideOrderPaymentTransition,
  type OrderLifecycleStatus,
} from "./order-state-machine.js";

const PAYMENT_ATTEMPT_ID = "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2";
const OTHER_PAYMENT_ATTEMPT_ID = "a2f80a06-1c38-4591-a0e7-a86cc00e98ad";

function paymentEvidence(
  status:
    "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "EXPIRED" | "UNKNOWN",
): Extract<AcceptedProviderEvidence, { eventType: "PAYMENT_STATUS" }> {
  const result = validateProviderEvidence(
    {
      eventType: "PAYMENT_STATUS",
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      externalReference: "pay_1",
      amountMinor: 2_500,
      currency: "USD",
    },
    providerEventSchema.parse({
      schemaVersion: 1,
      eventType: "PAYMENT_STATUS",
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      providerEventId: `evt_order_${status.toLowerCase()}`,
      evidence: {
        kind: "AUTHENTICATED_RECONCILE",
        auditLogId: "7299abb9-f6ad-4b06-830b-a7bd19352548",
      },
      occurredAt: "2026-09-03T02:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: PAYMENT_ATTEMPT_ID,
        externalReference: "pay_1",
      },
      status,
      amountMinor: 2_500,
      currency: "USD",
    }),
  );
  if (
    result.decision !== "ACCEPTED" ||
    result.evidence.eventType !== "PAYMENT_STATUS"
  ) {
    throw new Error("payment evidence fixture must validate");
  }
  return result.evidence;
}

describe("order lifecycle state machine", () => {
  test("implements the normal lifecycle and makes same-state requests no-ops", () => {
    const transitions: ReadonlyArray<
      readonly [
        OrderLifecycleStatus,
        OrderLifecycleStatus,
        Parameters<typeof decideOrderLifecycleTransition>[2],
      ]
    > = [
      ["DRAFT", "PENDING_PAYMENT", { kind: "CHECKOUT_CREATED" }],
      [
        "PENDING_PAYMENT",
        "OPEN",
        {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          evidence: paymentEvidence("SUCCEEDED"),
        },
      ],
      ["OPEN", "CLOSED", { kind: "FULFILLMENT_COMPLETED" }],
    ];

    for (const [from, to, authority] of transitions) {
      expect(decideOrderLifecycleTransition(from, to, authority).decision).toBe(
        "APPLIED",
      );
    }

    expect(
      decideOrderLifecycleTransition("OPEN", "OPEN", {
        kind: "HTTP_TIMEOUT",
      }),
    ).toMatchObject({ decision: "NOOP", effects: [] });
  });

  test("does not cancel a pending order for timeout, PROCESSING, or UNKNOWN", () => {
    expect(
      decideOrderLifecycleTransition("PENDING_PAYMENT", "CANCELED", {
        kind: "HTTP_TIMEOUT",
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_CANCELLATION_NOT_AUTHORIZED",
    });

    for (const status of ["PROCESSING", "UNKNOWN"] as const) {
      expect(
        decideOrderLifecycleTransition("PENDING_PAYMENT", "CANCELED", {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          evidence: paymentEvidence(status),
        }),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "ORDER_CANCELLATION_NOT_AUTHORIZED",
      });
    }
  });

  test("allows audited cancellation but reserves late success recovery for the coordinated planner", () => {
    expect(
      decideOrderLifecycleTransition("PENDING_PAYMENT", "CANCELED", {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: "2d9d13eb-7835-4fef-b207-a316250e1b23",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideOrderLifecycleTransition("CANCELED", "OPEN", {
        kind: "LATE_PROVIDER_SUCCESS",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: paymentEvidence("SUCCEEDED"),
      } as unknown as Parameters<typeof decideOrderLifecycleTransition>[2])
        .decision,
    ).toBe("REJECTED");

    expect(
      decideOrderLifecycleTransition("CANCELED", "OPEN", {
        kind: "HTTP_TIMEOUT",
      }).decision,
    ).toBe("REJECTED");
  });

  test("reports attempts to leave CLOSED as conflicts", () => {
    expect(
      decideOrderLifecycleTransition("CLOSED", "OPEN", {
        kind: "HTTP_TIMEOUT",
      }),
    ).toMatchObject({
      decision: "CONFLICT",
      reasonCode: "ORDER_TERMINAL_STATE_CONFLICT",
      effects: [],
    });
  });
});

describe("order payment aggregate", () => {
  test("advances only from an attempt and trusted success", () => {
    expect(
      decideOrderPaymentTransition("UNPAID", "PENDING", {
        kind: "ATTEMPT_CREATED",
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideOrderPaymentTransition("PENDING", "PAID", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: paymentEvidence("SUCCEEDED"),
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideOrderPaymentTransition("PENDING", "UNPAID", {
        kind: "ATTEMPT_CREATED",
      }).decision,
    ).toBe("REJECTED");
  });

  test("derives partial and full refunds from cumulative successful amounts", () => {
    expect(
      decideOrderPaymentTransition("PAID", "PARTIALLY_REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 2_500,
        succeededRefundAmountMinor: 1_000,
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideOrderPaymentTransition("PAID", "REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 2_500,
        succeededRefundAmountMinor: 2_500,
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideOrderPaymentTransition("PAID", "PARTIALLY_REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 2_500,
        succeededRefundAmountMinor: 2_500,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_REFUND_TOTAL_MISMATCH",
    });
  });

  test("rejects invalid cumulative refund totals without aggregate effects", () => {
    const invalidTotals = [
      { capturedAmountMinor: 0, succeededRefundAmountMinor: 0 },
      { capturedAmountMinor: -1, succeededRefundAmountMinor: 0 },
      {
        capturedAmountMinor: Number.MAX_SAFE_INTEGER + 1,
        succeededRefundAmountMinor: 1,
      },
      { capturedAmountMinor: 100, succeededRefundAmountMinor: -1 },
      {
        capturedAmountMinor: Number.MAX_SAFE_INTEGER,
        succeededRefundAmountMinor: Number.MAX_SAFE_INTEGER + 1,
      },
      { capturedAmountMinor: 100, succeededRefundAmountMinor: 101 },
    ] as const;

    for (const totals of invalidTotals) {
      expect(
        decideOrderPaymentTransition("PAID", "PARTIALLY_REFUNDED", {
          kind: "REFUND_TOTALS",
          ...totals,
        }),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "ORDER_REFUND_TOTAL_MISMATCH",
        effects: [],
      });
    }
  });

  test("handles minimum partial and maximum exact-full refund boundaries", () => {
    expect(
      decideOrderPaymentTransition("PAID", "PARTIALLY_REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 2,
        succeededRefundAmountMinor: 1,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      reasonCode: "ORDER_REFUND_TOTAL_CONFIRMED",
      effects: [{ type: "ORDER_PAYMENT_STATUS_CHANGED" }],
    });

    expect(
      decideOrderPaymentTransition("PARTIALLY_REFUNDED", "REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: Number.MAX_SAFE_INTEGER,
        succeededRefundAmountMinor: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      reasonCode: "ORDER_REFUND_TOTAL_CONFIRMED",
      effects: [{ type: "ORDER_PAYMENT_STATUS_CHANGED" }],
    });
  });

  test("keeps REFUNDED terminal and idempotent", () => {
    expect(
      decideOrderPaymentTransition("REFUNDED", "REFUNDED", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 100,
        succeededRefundAmountMinor: 100,
      }),
    ).toMatchObject({ decision: "NOOP", effects: [] });

    expect(
      decideOrderPaymentTransition("REFUNDED", "PAID", {
        kind: "REFUND_TOTALS",
        capturedAmountMinor: 100,
        succeededRefundAmountMinor: 0,
      }),
    ).toMatchObject({
      decision: "CONFLICT",
      reasonCode: "ORDER_PAYMENT_TERMINAL_STATE_CONFLICT",
    });
  });

  test("rejects payment evidence bound to another attempt or missing runtime proof", () => {
    const evidence = paymentEvidence("SUCCEEDED");
    const structuralCopy = { ...evidence } as unknown as typeof evidence;

    expect(
      decideOrderLifecycleTransition("PENDING_PAYMENT", "OPEN", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
        evidence,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PROVIDER_EVIDENCE_INVALID",
    });

    expect(
      decideOrderPaymentTransition("PENDING", "PAID", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: structuralCopy,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PROVIDER_EVIDENCE_INVALID",
    });

    expect(
      decideOrderPaymentTransition("PENDING", "PAID", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
        evidence,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PROVIDER_EVIDENCE_INVALID",
    });
  });

  test("validates audited cancellation identifiers and controlled reason codes", () => {
    for (const authority of [
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "not-an-audit-log-id",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "2d9d13eb-7835-4fef-b207-a316250e1b23",
        reasonCode: "",
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "2d9d13eb-7835-4fef-b207-a316250e1b23",
        reasonCode: "customer requested cancel",
      },
    ]) {
      expect(
        decideOrderLifecycleTransition(
          "PENDING_PAYMENT",
          "CANCELED",
          authority,
        ),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "ORDER_AUDITED_CANCEL_INVALID",
      });
    }
  });
});
