import type {
  Dispute,
  PaymentAttempt,
  ProviderEvent,
  Refund,
} from "@fan-support/contracts";

type PaymentAttemptStatus = PaymentAttempt["status"];
type RefundStatus = Refund["status"];
type ProviderDisputeStatus = Exclude<Dispute["status"], "NONE">;
type PaymentEnvironment = PaymentAttempt["environment"];

const acceptedProviderEvidenceBrand: unique symbol = Symbol(
  "accepted-provider-evidence",
);

type ProviderEvidenceTargetBase = Readonly<{
  paymentAttemptId: string;
  providerAccountId: string;
  environment: PaymentEnvironment;
  externalReference?: string;
  amountMinor: number;
  currency: string;
}>;

export type ProviderEvidenceTarget =
  | (ProviderEvidenceTargetBase &
      Readonly<{
        eventType: "PAYMENT_STATUS";
      }>)
  | (ProviderEvidenceTargetBase &
      Readonly<{
        eventType: "REFUND_STATUS";
        providerReference: string;
      }>)
  | (ProviderEvidenceTargetBase &
      Readonly<{
        eventType: "DISPUTE_STATUS";
        providerReference: string;
      }>);

export type AcceptedEvidenceReference =
  | Readonly<{
      kind: "VERIFIED_WEBHOOK";
      referenceId: string;
    }>
  | Readonly<{
      kind: "AUTHENTICATED_RECONCILE";
      referenceId: string;
    }>;

type AcceptedProviderEvidenceBase = Readonly<{
  [acceptedProviderEvidenceBrand]: true;
  schemaVersion: 1;
  kind: "ACCEPTED_PROVIDER_EVIDENCE";
  providerEventId: string;
  occurredAt: string;
  evidence: AcceptedEvidenceReference;
  association: Readonly<{
    paymentAttemptId: string;
    externalReference: string;
  }>;
}>;

export type AcceptedProviderEvidence =
  | (AcceptedProviderEvidenceBase &
      Readonly<{
        eventType: "PAYMENT_STATUS";
        status: PaymentAttemptStatus;
      }>)
  | (AcceptedProviderEvidenceBase &
      Readonly<{
        eventType: "REFUND_STATUS";
        status: RefundStatus;
        providerReference: string;
      }>)
  | (AcceptedProviderEvidenceBase &
      Readonly<{
        eventType: "DISPUTE_STATUS";
        status: ProviderDisputeStatus;
        providerReference: string;
      }>);

export type AcceptedProviderEvidenceExpectation =
  | Readonly<{
      eventType: "PAYMENT_STATUS";
      expectedPaymentAttemptId: string;
      expectedStatus?: PaymentAttemptStatus;
    }>
  | Readonly<{
      eventType: "REFUND_STATUS";
      expectedPaymentAttemptId: string;
      expectedProviderReference: string;
      expectedStatus?: RefundStatus;
    }>
  | Readonly<{
      eventType: "DISPUTE_STATUS";
      expectedPaymentAttemptId: string;
      expectedProviderReference: string;
      expectedStatus?: ProviderDisputeStatus;
    }>;

export type ProviderEvidenceRejectionCode =
  | "PROVIDER_EVENT_TYPE_MISMATCH"
  | "PROVIDER_EVENT_UNMATCHED"
  | "PROVIDER_ACCOUNT_MISMATCH"
  | "PROVIDER_ENVIRONMENT_MISMATCH"
  | "PAYMENT_ATTEMPT_MISMATCH"
  | "EXTERNAL_REFERENCE_MISMATCH"
  | "PROVIDER_REFERENCE_MISMATCH"
  | "PROVIDER_AMOUNT_MISMATCH"
  | "PROVIDER_CURRENCY_MISMATCH";

export type ProviderEvidenceValidation =
  | Readonly<{
      schemaVersion: 1;
      decision: "ACCEPTED";
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{
      schemaVersion: 1;
      decision: "REJECTED";
      reasonCode: ProviderEvidenceRejectionCode;
      effects: readonly [];
    }>;

function rejectEvidence(
  reasonCode: ProviderEvidenceRejectionCode,
): ProviderEvidenceValidation {
  return {
    schemaVersion: 1,
    decision: "REJECTED",
    reasonCode,
    effects: [],
  };
}

function projectEvidenceReference(
  event: ProviderEvent,
): AcceptedEvidenceReference {
  return event.evidence.kind === "VERIFIED_WEBHOOK"
    ? {
        kind: "VERIFIED_WEBHOOK",
        referenceId: String(event.evidence.webhookInboxId),
      }
    : {
        kind: "AUTHENTICATED_RECONCILE",
        referenceId: String(event.evidence.auditLogId),
      };
}

function projectAcceptedEvidence(
  event: ProviderEvent,
): AcceptedProviderEvidence {
  if (event.association.status !== "MATCHED") {
    throw new Error("matched provider evidence required");
  }

  const base = {
    schemaVersion: 1 as const,
    kind: "ACCEPTED_PROVIDER_EVIDENCE" as const,
    providerEventId: String(event.providerEventId),
    occurredAt: event.occurredAt,
    evidence: projectEvidenceReference(event),
    association: {
      paymentAttemptId: String(event.association.paymentAttemptId),
      externalReference: String(event.association.externalReference),
    },
  };

  const projectedEvidence = (() => {
    switch (event.eventType) {
      case "PAYMENT_STATUS":
        return { ...base, eventType: event.eventType, status: event.status };
      case "REFUND_STATUS":
        return {
          ...base,
          eventType: event.eventType,
          status: event.status,
          providerReference: String(event.refundReference),
        };
      case "DISPUTE_STATUS":
        return {
          ...base,
          eventType: event.eventType,
          status: event.status,
          providerReference: String(event.disputeReference),
        };
    }
  })();

  Object.freeze(projectedEvidence.evidence);
  Object.freeze(projectedEvidence.association);
  Object.defineProperty(projectedEvidence, acceptedProviderEvidenceBrand, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(projectedEvidence) as AcceptedProviderEvidence;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAcceptedProviderEvidenceFor(
  evidence: unknown,
  expectation: AcceptedProviderEvidenceExpectation,
): evidence is AcceptedProviderEvidence {
  if (
    !isRecord(evidence) ||
    evidence[acceptedProviderEvidenceBrand] !== true ||
    evidence["eventType"] !== expectation.eventType ||
    !isRecord(evidence["association"]) ||
    evidence["association"]["paymentAttemptId"] !==
      expectation.expectedPaymentAttemptId
  ) {
    return false;
  }

  if (
    expectation.expectedStatus !== undefined &&
    evidence["status"] !== expectation.expectedStatus
  ) {
    return false;
  }

  if (
    expectation.eventType === "REFUND_STATUS" ||
    expectation.eventType === "DISPUTE_STATUS"
  ) {
    return (
      evidence["providerReference"] === expectation.expectedProviderReference
    );
  }

  return true;
}

export function validateProviderEvidence(
  target: ProviderEvidenceTarget,
  event: ProviderEvent,
): ProviderEvidenceValidation {
  if (event.eventType !== target.eventType) {
    return rejectEvidence("PROVIDER_EVENT_TYPE_MISMATCH");
  }
  if (String(event.providerAccountId) !== target.providerAccountId) {
    return rejectEvidence("PROVIDER_ACCOUNT_MISMATCH");
  }
  if (event.environment !== target.environment) {
    return rejectEvidence("PROVIDER_ENVIRONMENT_MISMATCH");
  }
  if (event.association.status !== "MATCHED") {
    return rejectEvidence("PROVIDER_EVENT_UNMATCHED");
  }
  if (String(event.association.paymentAttemptId) !== target.paymentAttemptId) {
    return rejectEvidence("PAYMENT_ATTEMPT_MISMATCH");
  }
  if (
    target.externalReference !== undefined &&
    String(event.association.externalReference) !== target.externalReference
  ) {
    return rejectEvidence("EXTERNAL_REFERENCE_MISMATCH");
  }
  if (event.amountMinor !== target.amountMinor) {
    return rejectEvidence("PROVIDER_AMOUNT_MISMATCH");
  }
  if (event.currency !== target.currency) {
    return rejectEvidence("PROVIDER_CURRENCY_MISMATCH");
  }
  if (
    target.eventType === "REFUND_STATUS" &&
    event.eventType === "REFUND_STATUS" &&
    String(event.refundReference) !== target.providerReference
  ) {
    return rejectEvidence("PROVIDER_REFERENCE_MISMATCH");
  }
  if (
    target.eventType === "DISPUTE_STATUS" &&
    event.eventType === "DISPUTE_STATUS" &&
    String(event.disputeReference) !== target.providerReference
  ) {
    return rejectEvidence("PROVIDER_REFERENCE_MISMATCH");
  }

  return {
    schemaVersion: 1,
    decision: "ACCEPTED",
    evidence: projectAcceptedEvidence(event),
  };
}
