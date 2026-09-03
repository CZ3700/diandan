import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { providerEventSchema } from "@fan-support/contracts";

import {
  validateProviderEvidence,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import {
  decidePaymentAttemptTransition,
  type PaymentAttemptStatus,
} from "./payment-state-machine.js";

const PAYMENT_ATTEMPT_ID = "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2";
const OTHER_PAYMENT_ATTEMPT_ID = "a2f80a06-1c38-4591-a0e7-a86cc00e98ad";

function paymentEvidence(
  status: PaymentAttemptStatus,
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
      providerEventId: `evt_payment_${status.toLowerCase()}`,
      evidence: {
        kind: "VERIFIED_WEBHOOK",
        webhookInboxId: "f219e263-c97d-4249-94ed-7c5473020cca",
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

describe("payment attempt state machine", () => {
  test("treats a same-state request as an idempotent no-op", () => {
    expect(
      decidePaymentAttemptTransition("PROCESSING", "PROCESSING", {
        kind: "BROWSER_RETURN",
      }),
    ).toEqual({
      schemaVersion: 1,
      decision: "NOOP",
      from: "PROCESSING",
      to: "PROCESSING",
      reasonCode: "ALREADY_APPLIED",
      effects: [],
    });
  });

  test("allows providers to skip forward states but requires trusted evidence for success", () => {
    expect(
      decidePaymentAttemptTransition("CREATED", "PROCESSING", {
        kind: "CREATE_RESULT",
      }).decision,
    ).toBe("APPLIED");

    expect(
      decidePaymentAttemptTransition("CREATED", "SUCCEEDED", {
        kind: "BROWSER_RETURN",
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
      effects: [],
    });

    expect(
      decidePaymentAttemptTransition("CREATED", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: paymentEvidence("SUCCEEDED"),
      }),
    ).toMatchObject({
      decision: "APPLIED",
      to: "SUCCEEDED",
      effects: [
        { type: "PAYMENT_STATUS_CHANGED" },
        { type: "PAYMENT_SUCCEEDED" },
      ],
    });
  });

  test("enters UNKNOWN only for an operation that may have committed", () => {
    expect(
      decidePaymentAttemptTransition("PROCESSING", "UNKNOWN", {
        kind: "NETWORK_UNCERTAINTY",
        operationMayHaveCommitted: false,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_UNCERTAINTY_NOT_ESTABLISHED",
    });

    expect(
      decidePaymentAttemptTransition("PROCESSING", "UNKNOWN", {
        kind: "NETWORK_UNCERTAINTY",
        operationMayHaveCommitted: true,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      effects: [
        { type: "PAYMENT_STATUS_CHANGED" },
        { type: "PAYMENT_RECONCILIATION_REQUIRED" },
      ],
    });
  });

  test("allows audited cancel or safe expiry only before a provider call", () => {
    expect(
      decidePaymentAttemptTransition("CREATED", "CANCELED", {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: "32554abe-0da2-4f18-926a-9968966826cf",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        providerCallStarted: false,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      reasonCode: "PAYMENT_CANCELED_BEFORE_PROVIDER_CALL",
    });

    expect(
      decidePaymentAttemptTransition("CREATED", "EXPIRED", {
        kind: "SAFE_EXPIRY",
        providerCallStarted: false,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      reasonCode: "PAYMENT_EXPIRED_BEFORE_PROVIDER_CALL",
    });

    expect(
      decidePaymentAttemptTransition("CREATED", "REQUIRES_ACTION", {
        kind: "CREATE_RESULT",
      }).decision,
    ).toBe("APPLIED");
  });

  test("allows UNKNOWN to resolve to any provider-confirmed explicit state", () => {
    const explicitStatuses = [
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "EXPIRED",
    ] as const;
    fc.assert(
      fc.property(fc.constantFrom(...explicitStatuses), (target) => {
        expect(
          decidePaymentAttemptTransition("UNKNOWN", target, {
            kind: "PROVIDER_EVIDENCE",
            expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
            evidence: paymentEvidence(target),
          }).decision,
        ).toBe("APPLIED");
      }),
      { seed: 0x5eed0103, numRuns: 200 },
    );
  });

  test("rejects mismatched evidence and reports explicit terminal conflicts", () => {
    expect(
      decidePaymentAttemptTransition("UNKNOWN", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: paymentEvidence("FAILED"),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_EVIDENCE_STATUS_MISMATCH",
    });

    expect(
      decidePaymentAttemptTransition("SUCCEEDED", "FAILED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
        evidence: paymentEvidence("FAILED"),
      }),
    ).toEqual({
      schemaVersion: 1,
      decision: "CONFLICT",
      from: "SUCCEEDED",
      to: "FAILED",
      reasonCode: "PAYMENT_TERMINAL_STATE_CONFLICT",
      effects: [],
    });
  });

  test("rejects evidence reused for another attempt or stripped of its runtime proof", () => {
    const evidence = paymentEvidence("SUCCEEDED");
    const unbrandedRoundTrip = JSON.parse(
      JSON.stringify(evidence),
    ) as unknown as typeof evidence;
    const structuralCopy = { ...evidence } as unknown as typeof evidence;

    for (const candidate of [unbrandedRoundTrip, structuralCopy]) {
      expect(
        decidePaymentAttemptTransition("PROCESSING", "SUCCEEDED", {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: PAYMENT_ATTEMPT_ID,
          evidence: candidate,
        }),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "PAYMENT_PROVIDER_EVIDENCE_INVALID",
        effects: [],
      });
    }

    expect(
      decidePaymentAttemptTransition("PROCESSING", "SUCCEEDED", {
        kind: "PROVIDER_EVIDENCE",
        expectedPaymentAttemptId: OTHER_PAYMENT_ATTEMPT_ID,
        evidence,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_PROVIDER_EVIDENCE_INVALID",
      effects: [],
    });
  });

  test("validates audited cancellation identifiers and controlled reason codes", () => {
    for (const authority of [
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        providerCallStarted: false as const,
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "not-an-audit-log-id",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        providerCallStarted: false as const,
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "32554abe-0da2-4f18-926a-9968966826cf",
        reasonCode: "",
        providerCallStarted: false as const,
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL" as const,
        auditLogId: "32554abe-0da2-4f18-926a-9968966826cf",
        reasonCode: "customer requested cancel",
        providerCallStarted: false as const,
      },
    ]) {
      expect(
        decidePaymentAttemptTransition("CREATED", "CANCELED", authority),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "PAYMENT_AUDITED_CANCEL_INVALID",
        effects: [],
      });
    }
  });
});
