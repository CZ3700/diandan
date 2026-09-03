import { auditLogIdSchema, type PaymentAttempt } from "@fan-support/contracts";

import {
  isAcceptedProviderEvidenceFor,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import {
  appliedTransition,
  conflictingTransition,
  noopTransition,
  rejectedTransition,
  type TransitionDecision,
  type TransitionEffect,
} from "./transition-decision.js";

export type PaymentAttemptStatus = PaymentAttempt["status"];

export type PaymentTransitionAuthority =
  | Readonly<{ kind: "CREATE_RESULT" }>
  | Readonly<{
      kind: "PROVIDER_EVIDENCE";
      expectedPaymentAttemptId: string;
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{
      kind: "NETWORK_UNCERTAINTY";
      operationMayHaveCommitted: boolean;
    }>
  | Readonly<{
      kind: "AUDITED_BUSINESS_CANCEL";
      auditLogId: string;
      reasonCode: string;
      providerCallStarted: false;
    }>
  | Readonly<{
      kind: "SAFE_EXPIRY";
      providerCallStarted: false;
    }>
  | Readonly<{ kind: "BROWSER_RETURN" }>;

const TERMINAL_PAYMENT_STATUSES = new Set<PaymentAttemptStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
]);

const PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>
> = {
  CREATED: [
    "REQUIRES_ACTION",
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
    "EXPIRED",
    "UNKNOWN",
  ],
  REQUIRES_ACTION: [
    "PROCESSING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
    "EXPIRED",
    "UNKNOWN",
  ],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED", "UNKNOWN"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELED: [],
  EXPIRED: [],
  UNKNOWN: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"],
};

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;

function hasMatchingPaymentEvidence(
  authority: PaymentTransitionAuthority,
): boolean {
  return (
    authority.kind === "PROVIDER_EVIDENCE" &&
    isAcceptedProviderEvidenceFor(authority.evidence, {
      eventType: "PAYMENT_STATUS",
      expectedPaymentAttemptId: authority.expectedPaymentAttemptId,
    })
  );
}

function hasMatchingPaymentEvidenceStatus(
  authority: Extract<PaymentTransitionAuthority, { kind: "PROVIDER_EVIDENCE" }>,
  target: PaymentAttemptStatus,
): boolean {
  return (
    authority.evidence.eventType === "PAYMENT_STATUS" &&
    authority.evidence.status === target
  );
}

function hasValidAuditedCancel(
  authority: Extract<
    PaymentTransitionAuthority,
    { kind: "AUDITED_BUSINESS_CANCEL" }
  >,
): boolean {
  return (
    auditLogIdSchema.safeParse(authority.auditLogId).success &&
    REASON_CODE_PATTERN.test(authority.reasonCode)
  );
}

function effectsForPaymentStatus(
  target: PaymentAttemptStatus,
): readonly TransitionEffect[] {
  const effects: TransitionEffect[] = [{ type: "PAYMENT_STATUS_CHANGED" }];
  if (target === "UNKNOWN") {
    effects.push({ type: "PAYMENT_RECONCILIATION_REQUIRED" });
  }
  if (target === "SUCCEEDED") {
    effects.push({ type: "PAYMENT_SUCCEEDED" });
  }
  return effects;
}

function applyPaymentTransition(
  current: PaymentAttemptStatus,
  target: PaymentAttemptStatus,
  reasonCode: string,
): TransitionDecision<PaymentAttemptStatus> {
  return appliedTransition(
    current,
    target,
    reasonCode,
    effectsForPaymentStatus(target),
  );
}

export function decidePaymentAttemptTransition(
  current: PaymentAttemptStatus,
  target: PaymentAttemptStatus,
  authority: PaymentTransitionAuthority,
): TransitionDecision<PaymentAttemptStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (TERMINAL_PAYMENT_STATUSES.has(current)) {
    return conflictingTransition(
      current,
      target,
      "PAYMENT_TERMINAL_STATE_CONFLICT",
    );
  }
  if (!PAYMENT_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(
      current,
      target,
      "PAYMENT_TRANSITION_NOT_ALLOWED",
    );
  }

  if (target === "UNKNOWN") {
    return authority.kind === "NETWORK_UNCERTAINTY" &&
      authority.operationMayHaveCommitted
      ? applyPaymentTransition(current, target, "PAYMENT_RESULT_UNCERTAIN")
      : rejectedTransition(
          current,
          target,
          "PAYMENT_UNCERTAINTY_NOT_ESTABLISHED",
        );
  }

  if (
    current === "CREATED" &&
    (target === "REQUIRES_ACTION" || target === "PROCESSING") &&
    authority.kind === "CREATE_RESULT"
  ) {
    return applyPaymentTransition(
      current,
      target,
      "PAYMENT_CREATE_RESULT_RECORDED",
    );
  }

  if (
    current === "CREATED" &&
    target === "CANCELED" &&
    authority.kind === "AUDITED_BUSINESS_CANCEL" &&
    !authority.providerCallStarted
  ) {
    if (!hasValidAuditedCancel(authority)) {
      return rejectedTransition(
        current,
        target,
        "PAYMENT_AUDITED_CANCEL_INVALID",
      );
    }
    return applyPaymentTransition(
      current,
      target,
      "PAYMENT_CANCELED_BEFORE_PROVIDER_CALL",
    );
  }

  if (
    current === "CREATED" &&
    target === "EXPIRED" &&
    authority.kind === "SAFE_EXPIRY" &&
    !authority.providerCallStarted
  ) {
    return applyPaymentTransition(
      current,
      target,
      "PAYMENT_EXPIRED_BEFORE_PROVIDER_CALL",
    );
  }

  if (authority.kind !== "PROVIDER_EVIDENCE") {
    return rejectedTransition(
      current,
      target,
      "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
    );
  }
  if (!hasMatchingPaymentEvidence(authority)) {
    return rejectedTransition(
      current,
      target,
      "PAYMENT_PROVIDER_EVIDENCE_INVALID",
    );
  }
  if (!hasMatchingPaymentEvidenceStatus(authority, target)) {
    return rejectedTransition(
      current,
      target,
      "PAYMENT_EVIDENCE_STATUS_MISMATCH",
    );
  }

  return applyPaymentTransition(
    current,
    target,
    "PAYMENT_PROVIDER_STATUS_CONFIRMED",
  );
}
