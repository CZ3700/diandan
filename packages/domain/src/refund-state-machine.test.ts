import { describe, expect, test } from "vitest";

import { providerEventSchema } from "@fan-support/contracts";

import {
  validateProviderEvidence,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import {
  decideRefundTransition,
  type RefundStatus,
} from "./refund-state-machine.js";

const PAYMENT_ATTEMPT_ID = "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2";
const OTHER_PAYMENT_ATTEMPT_ID = "a2f80a06-1c38-4591-a0e7-a86cc00e98ad";
const REFUND_REFERENCE = "refund_1";

function refundEvidence(
  status: RefundStatus,
): Extract<AcceptedProviderEvidence, { eventType: "REFUND_STATUS" }> {
  const result = validateProviderEvidence(
    {
      eventType: "REFUND_STATUS",
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      externalReference: "pay_1",
      providerReference: REFUND_REFERENCE,
      amountMinor: 1_000,
      currency: "USD",
    },
    providerEventSchema.parse({
      schemaVersion: 1,
      eventType: "REFUND_STATUS",
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      providerEventId: `evt_refund_${status.toLowerCase()}`,
      evidence: {
        kind: "VERIFIED_WEBHOOK",
        webhookInboxId: "30cfaafa-2539-47e1-a44d-de6cd2fe7f5f",
      },
      occurredAt: "2026-09-03T02:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: PAYMENT_ATTEMPT_ID,
        externalReference: "pay_1",
      },
      refundReference: REFUND_REFERENCE,
      status,
      amountMinor: 1_000,
      currency: "USD",
    }),
  );
  if (
    result.decision !== "ACCEPTED" ||
    result.evidence.eventType !== "REFUND_STATUS"
  ) {
    throw new Error("refund evidence fixture must validate");
  }
  return result.evidence;
}

describe("refund state machine", () => {
  test("persists SUBMITTING before applying any provider result", () => {
    expect(
      decideRefundTransition("REQUESTED", "SUBMITTING", {
        kind: "SUBMIT_COMMAND",
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideRefundTransition("REQUESTED", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence: refundEvidence("SUCCEEDED"),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "REFUND_TRANSITION_NOT_ALLOWED",
    });
  });

  test("allows provider results to skip PROCESSING after SUBMITTING", () => {
    for (const target of ["PROCESSING", "SUCCEEDED", "FAILED"] as const) {
      expect(
        decideRefundTransition("SUBMITTING", target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          expectedProviderReference: REFUND_REFERENCE,
          evidence: refundEvidence(target),
        }).decision,
      ).toBe("APPLIED");
    }
  });

  test("marks uncertain submissions UNKNOWN and requires evidence to resolve them", () => {
    expect(
      decideRefundTransition("SUBMITTING", "UNKNOWN", {
        kind: "NETWORK_UNCERTAINTY",
        operationMayHaveCommitted: true,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      effects: [
        { type: "REFUND_STATUS_CHANGED" },
        { type: "REFUND_RECONCILIATION_REQUIRED" },
      ],
    });

    expect(
      decideRefundTransition("UNKNOWN", "FAILED", {
        kind: "BROWSER_RETURN",
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "REFUND_PROVIDER_EVIDENCE_REQUIRED",
    });

    for (const target of ["PROCESSING", "SUCCEEDED", "FAILED"] as const) {
      expect(
        decideRefundTransition("UNKNOWN", target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          expectedProviderReference: REFUND_REFERENCE,
          evidence: refundEvidence(target),
        }).decision,
      ).toBe("APPLIED");
    }
  });

  test("makes duplicate terminal evidence a no-op and contradictory evidence a conflict", () => {
    expect(
      decideRefundTransition("SUCCEEDED", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence: refundEvidence("SUCCEEDED"),
      }),
    ).toMatchObject({ decision: "NOOP", effects: [] });

    expect(
      decideRefundTransition("SUCCEEDED", "FAILED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence: refundEvidence("FAILED"),
      }),
    ).toMatchObject({
      decision: "CONFLICT",
      reasonCode: "REFUND_TERMINAL_STATE_CONFLICT",
      effects: [],
    });
  });

  test("rejects trusted refund evidence whose status differs from the target", () => {
    expect(
      decideRefundTransition("SUBMITTING", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence: refundEvidence("PROCESSING"),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "REFUND_EVIDENCE_STATUS_MISMATCH",
      effects: [],
    });
  });

  test("rejects evidence reused across attempts or refund references", () => {
    const evidence = refundEvidence("SUCCEEDED");

    for (const authority of [
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence,
      },
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: "refund_other",
        evidence,
      },
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: REFUND_REFERENCE,
        evidence: JSON.parse(
          JSON.stringify(evidence),
        ) as unknown as typeof evidence,
      },
    ]) {
      expect(
        decideRefundTransition("PROCESSING", "SUCCEEDED", authority),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "REFUND_PROVIDER_EVIDENCE_INVALID",
        effects: [],
      });
    }
  });
});
