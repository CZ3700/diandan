import { describe, expect, test } from "vitest";

import { providerEventSchema } from "@fan-support/contracts";

import {
  validateProviderEvidence,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import {
  decideDisputeTransition,
  type DisputeStatus,
} from "./dispute-state-machine.js";

const PAYMENT_ATTEMPT_ID = "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2";
const OTHER_PAYMENT_ATTEMPT_ID = "a2f80a06-1c38-4591-a0e7-a86cc00e98ad";
const DISPUTE_REFERENCE = "dispute_1";

function disputeEvidence(
  status: Exclude<DisputeStatus, "NONE">,
): Extract<AcceptedProviderEvidence, { eventType: "DISPUTE_STATUS" }> {
  const result = validateProviderEvidence(
    {
      eventType: "DISPUTE_STATUS",
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      externalReference: "pay_1",
      providerReference: DISPUTE_REFERENCE,
      amountMinor: 2_500,
      currency: "USD",
    },
    providerEventSchema.parse({
      schemaVersion: 1,
      eventType: "DISPUTE_STATUS",
      providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
      environment: "TEST",
      providerEventId: `evt_dispute_${status.toLowerCase()}`,
      evidence: {
        kind: "VERIFIED_WEBHOOK",
        webhookInboxId: "8a17bdc7-201f-4451-870e-831037f5a87c",
      },
      occurredAt: "2026-09-03T02:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: PAYMENT_ATTEMPT_ID,
        externalReference: "pay_1",
      },
      disputeReference: DISPUTE_REFERENCE,
      status,
      amountMinor: 2_500,
      currency: "USD",
    }),
  );
  if (
    result.decision !== "ACCEPTED" ||
    result.evidence.eventType !== "DISPUTE_STATUS"
  ) {
    throw new Error("dispute evidence fixture must validate");
  }
  return result.evidence;
}

describe("dispute projection state machine", () => {
  test("requires trusted provider evidence to open a dispute", () => {
    expect(
      decideDisputeTransition("NONE", "OPEN", {
        kind: "BROWSER_RETURN",
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "DISPUTE_PROVIDER_EVIDENCE_REQUIRED",
    });

    expect(
      decideDisputeTransition("NONE", "OPEN", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("OPEN"),
      }).decision,
    ).toBe("APPLIED");
  });

  test("accepts a first trusted terminal event when the provider skipped OPEN", () => {
    for (const target of ["WON", "LOST"] as const) {
      expect(
        decideDisputeTransition("NONE", target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          expectedProviderReference: DISPUTE_REFERENCE,
          evidence: disputeEvidence(target),
        }).decision,
      ).toBe("APPLIED");
    }
  });

  test("allows OPEN to resolve and keeps terminal projections sticky", () => {
    expect(
      decideDisputeTransition("OPEN", "WON", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("WON"),
      }).decision,
    ).toBe("APPLIED");

    expect(
      decideDisputeTransition("WON", "WON", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("WON"),
      }),
    ).toMatchObject({ decision: "NOOP", effects: [] });

    expect(
      decideDisputeTransition("WON", "LOST", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("LOST"),
      }),
    ).toMatchObject({
      decision: "CONFLICT",
      reasonCode: "DISPUTE_TERMINAL_STATE_CONFLICT",
      effects: [],
    });
  });

  test("rejects attempts to reverse an active or terminal dispute", () => {
    expect(
      decideDisputeTransition("OPEN", "NONE", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("OPEN"),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "DISPUTE_TRANSITION_NOT_ALLOWED",
      effects: [],
    });

    for (const current of ["WON", "LOST"] as const) {
      expect(
        decideDisputeTransition(current, "OPEN", {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          expectedProviderReference: DISPUTE_REFERENCE,
          evidence: disputeEvidence("OPEN"),
        }),
      ).toMatchObject({
        decision: "CONFLICT",
        reasonCode: "DISPUTE_TERMINAL_STATE_CONFLICT",
        effects: [],
      });
    }
  });

  test("rejects trusted dispute evidence whose status differs from the target", () => {
    expect(
      decideDisputeTransition("NONE", "OPEN", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: disputeEvidence("WON"),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "DISPUTE_EVIDENCE_STATUS_MISMATCH",
      effects: [],
    });
  });

  test("rejects evidence reused across attempts or dispute references", () => {
    const evidence = disputeEvidence("OPEN");

    for (const authority of [
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence,
      },
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: "dispute_other",
        evidence,
      },
      {
        kind: "PROVIDER_EVIDENCE" as const,
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        expectedProviderReference: DISPUTE_REFERENCE,
        evidence: { ...evidence } as unknown as typeof evidence,
      },
    ]) {
      expect(decideDisputeTransition("NONE", "OPEN", authority)).toMatchObject({
        decision: "REJECTED",
        reasonCode: "DISPUTE_PROVIDER_EVIDENCE_INVALID",
        effects: [],
      });
    }
  });
});
