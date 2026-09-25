import { describe, expect, test } from "vitest";

import { providerEventSchema } from "@fan-support/contracts";

import {
  isAcceptedProviderEvidenceFor,
  validateProviderEvidence,
  type ProviderEvidenceTarget,
} from "./provider-evidence.js";

const paymentTarget = {
  eventType: "PAYMENT_STATUS",
  paymentAttemptId: "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2",
  providerAccountId: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
  environment: "TEST",
  externalReference: "pay_1",
  amountMinor: 2_500,
  currency: "USD",
} satisfies ProviderEvidenceTarget;

function paymentEvent(overrides: Readonly<Record<string, unknown>> = {}) {
  return providerEventSchema.parse({
    schemaVersion: 1,
    eventType: "PAYMENT_STATUS",
    providerAccountId: paymentTarget.providerAccountId,
    environment: paymentTarget.environment,
    providerEventId: "evt_payment_1",
    evidence: {
      kind: "VERIFIED_WEBHOOK",
      webhookInboxId: "f219e263-c97d-4249-94ed-7c5473020cca",
    },
    occurredAt: "2026-09-03T02:00:00Z",
    association: {
      status: "MATCHED",
      paymentAttemptId: paymentTarget.paymentAttemptId,
      externalReference: paymentTarget.externalReference,
    },
    status: "SUCCEEDED",
    amountMinor: paymentTarget.amountMinor,
    currency: paymentTarget.currency,
    ...overrides,
  });
}

function refundEvent(
  providerReference: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return providerEventSchema.parse({
    schemaVersion: 1,
    eventType: "REFUND_STATUS",
    providerAccountId: paymentTarget.providerAccountId,
    environment: paymentTarget.environment,
    providerEventId: "evt_refund_1",
    evidence: {
      kind: "AUTHENTICATED_RECONCILE",
      auditLogId: "020745e1-48d2-437f-8f3f-780cc11d8734",
    },
    occurredAt: "2026-09-03T02:05:00Z",
    association: {
      status: "MATCHED",
      paymentAttemptId: paymentTarget.paymentAttemptId,
      externalReference: paymentTarget.externalReference,
    },
    refundReference: providerReference,
    status: "SUCCEEDED",
    amountMinor: 1_000,
    currency: paymentTarget.currency,
    ...overrides,
  });
}

function disputeEvent(
  providerReference: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return providerEventSchema.parse({
    schemaVersion: 1,
    eventType: "DISPUTE_STATUS",
    providerAccountId: paymentTarget.providerAccountId,
    environment: paymentTarget.environment,
    providerEventId: "evt_dispute_1",
    evidence: {
      kind: "VERIFIED_WEBHOOK",
      webhookInboxId: "4af98e51-d9d1-4cfe-8ed7-b2d844a01af5",
    },
    occurredAt: "2026-09-03T02:10:00Z",
    association: {
      status: "MATCHED",
      paymentAttemptId: paymentTarget.paymentAttemptId,
      externalReference: paymentTarget.externalReference,
    },
    disputeReference: providerReference,
    status: "OPEN",
    amountMinor: paymentTarget.amountMinor,
    currency: paymentTarget.currency,
    ...overrides,
  });
}

describe("provider evidence validation", () => {
  test("accepts matched evidence and projects only an allowlisted reference", () => {
    const result = validateProviderEvidence(paymentTarget, paymentEvent());

    expect(result).toEqual({
      schemaVersion: 1,
      decision: "ACCEPTED",
      evidence: {
        schemaVersion: 1,
        kind: "ACCEPTED_PROVIDER_EVIDENCE",
        eventType: "PAYMENT_STATUS",
        status: "SUCCEEDED",
        providerEventId: "evt_payment_1",
        occurredAt: "2026-09-03T02:00:00Z",
        evidence: {
          kind: "VERIFIED_WEBHOOK",
          referenceId: "f219e263-c97d-4249-94ed-7c5473020cca",
        },
        association: {
          paymentAttemptId: paymentTarget.paymentAttemptId,
          externalReference: paymentTarget.externalReference,
        },
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("rawBody");

    if (result.decision !== "ACCEPTED") {
      throw new Error("provider evidence fixture must validate");
    }
    expect(
      isAcceptedProviderEvidenceFor(result.evidence, {
        eventType: "PAYMENT_STATUS",
        expectedPaymentAttemptId: paymentTarget.paymentAttemptId,
        expectedStatus: "SUCCEEDED",
      }),
    ).toBe(true);

    const roundTripped = JSON.parse(JSON.stringify(result.evidence));
    expect(Object.getOwnPropertySymbols(roundTripped)).toEqual([]);
    expect(
      isAcceptedProviderEvidenceFor(roundTripped, {
        eventType: "PAYMENT_STATUS",
        expectedPaymentAttemptId: paymentTarget.paymentAttemptId,
        expectedStatus: "SUCCEEDED",
      }),
    ).toBe(false);
  });

  test("rejects unmatched and incorrectly bound events before state mutation", () => {
    const cases = [
      [
        paymentEvent({
          association: {
            status: "UNMATCHED",
            externalReference: paymentTarget.externalReference,
          },
        }),
        "PROVIDER_EVENT_UNMATCHED",
      ],
      [
        paymentEvent({
          association: {
            status: "MATCHED",
            paymentAttemptId: paymentTarget.paymentAttemptId,
            externalReference: "pay_other",
          },
        }),
        "EXTERNAL_REFERENCE_MISMATCH",
      ],
      [
        paymentEvent({
          providerAccountId: "3c8cff59-cb48-429a-8cdc-4f5a55ef8d4a",
        }),
        "PROVIDER_ACCOUNT_MISMATCH",
      ],
      [paymentEvent({ environment: "LIVE" }), "PROVIDER_ENVIRONMENT_MISMATCH"],
      [
        paymentEvent({
          association: {
            status: "MATCHED",
            paymentAttemptId: "a2f80a06-1c38-4591-a0e7-a86cc00e98ad",
            externalReference: paymentTarget.externalReference,
          },
        }),
        "PAYMENT_ATTEMPT_MISMATCH",
      ],
      [paymentEvent({ amountMinor: 2_499 }), "PROVIDER_AMOUNT_MISMATCH"],
      [paymentEvent({ currency: "EUR" }), "PROVIDER_CURRENCY_MISMATCH"],
    ] as const;

    for (const [event, reasonCode] of cases) {
      expect(validateProviderEvidence(paymentTarget, event)).toEqual({
        schemaVersion: 1,
        decision: "REJECTED",
        reasonCode,
        effects: [],
      });
    }
  });

  test("binds refund and dispute provider references", () => {
    const refundTarget = {
      ...paymentTarget,
      eventType: "REFUND_STATUS",
      providerReference: "refund_1",
      amountMinor: 1_000,
    } satisfies ProviderEvidenceTarget;
    expect(
      validateProviderEvidence(refundTarget, refundEvent("refund_other")),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PROVIDER_REFERENCE_MISMATCH",
    });

    expect(
      validateProviderEvidence(refundTarget, refundEvent("refund_1")),
    ).toMatchObject({
      decision: "ACCEPTED",
      evidence: {
        eventType: "REFUND_STATUS",
        providerReference: "refund_1",
        evidence: { kind: "AUTHENTICATED_RECONCILE" },
      },
    });

    const disputeTarget = {
      ...paymentTarget,
      eventType: "DISPUTE_STATUS",
      providerReference: "dispute_1",
    } satisfies ProviderEvidenceTarget;
    expect(
      validateProviderEvidence(disputeTarget, disputeEvent("dispute_other")),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PROVIDER_REFERENCE_MISMATCH",
    });
    expect(
      validateProviderEvidence(disputeTarget, disputeEvent("dispute_1")),
    ).toMatchObject({
      decision: "ACCEPTED",
      evidence: {
        eventType: "DISPUTE_STATUS",
        providerReference: "dispute_1",
      },
    });
  });

  test("rejects an event type mismatch and permits early matching without a stored external reference", () => {
    const refundTarget = {
      ...paymentTarget,
      eventType: "REFUND_STATUS",
      providerReference: "refund_1",
      amountMinor: 1_000,
    } satisfies ProviderEvidenceTarget;
    expect(
      validateProviderEvidence(refundTarget, paymentEvent()),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PROVIDER_EVENT_TYPE_MISMATCH",
    });

    const earlyTarget = {
      eventType: paymentTarget.eventType,
      paymentAttemptId: paymentTarget.paymentAttemptId,
      providerAccountId: paymentTarget.providerAccountId,
      environment: paymentTarget.environment,
      amountMinor: paymentTarget.amountMinor,
      currency: paymentTarget.currency,
    } satisfies ProviderEvidenceTarget;
    expect(validateProviderEvidence(earlyTarget, paymentEvent())).toMatchObject(
      { decision: "ACCEPTED" },
    );
  });
});
