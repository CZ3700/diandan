import type { Refund } from "@fan-support/contracts";

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

export type RefundStatus = Refund["status"];

export type RefundTransitionAuthority =
  | Readonly<{ kind: "SUBMIT_COMMAND" }>
  | Readonly<{
      kind: "PROVIDER_EVIDENCE";
      expectedPaymentAttemptId: string;
      expectedProviderReference: string;
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{
      kind: "NETWORK_UNCERTAINTY";
      operationMayHaveCommitted: boolean;
    }>
  | Readonly<{ kind: "BROWSER_RETURN" }>;

const TERMINAL_REFUND_STATUSES = new Set<RefundStatus>(["SUCCEEDED", "FAILED"]);

const REFUND_TRANSITIONS: Readonly<
  Record<RefundStatus, readonly RefundStatus[]>
> = {
  REQUESTED: ["SUBMITTING"],
  SUBMITTING: ["PROCESSING", "SUCCEEDED", "FAILED", "UNKNOWN"],
  PROCESSING: ["SUCCEEDED", "FAILED", "UNKNOWN"],
  SUCCEEDED: [],
  FAILED: [],
  UNKNOWN: ["PROCESSING", "SUCCEEDED", "FAILED"],
};

function refundEffects(target: RefundStatus): readonly TransitionEffect[] {
  const effects: TransitionEffect[] = [{ type: "REFUND_STATUS_CHANGED" }];
  if (target === "UNKNOWN") {
    effects.push({ type: "REFUND_RECONCILIATION_REQUIRED" });
  }
  if (target === "SUCCEEDED") {
    effects.push({ type: "REFUND_SUCCEEDED" });
  }
  return effects;
}

function hasMatchingRefundEvidence(
  authority: Extract<RefundTransitionAuthority, { kind: "PROVIDER_EVIDENCE" }>,
  target: RefundStatus,
): boolean {
  return (
    authority.evidence.eventType === "REFUND_STATUS" &&
    authority.evidence.status === target
  );
}

function hasAcceptedRefundEvidence(
  authority: Extract<RefundTransitionAuthority, { kind: "PROVIDER_EVIDENCE" }>,
): boolean {
  return isAcceptedProviderEvidenceFor(authority.evidence, {
    eventType: "REFUND_STATUS",
    expectedPaymentAttemptId: authority.expectedPaymentAttemptId,
    expectedProviderReference: authority.expectedProviderReference,
  });
}

export function decideRefundTransition(
  current: RefundStatus,
  target: RefundStatus,
  authority: RefundTransitionAuthority,
): TransitionDecision<RefundStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (TERMINAL_REFUND_STATUSES.has(current)) {
    return conflictingTransition(
      current,
      target,
      "REFUND_TERMINAL_STATE_CONFLICT",
    );
  }
  if (!REFUND_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(current, target, "REFUND_TRANSITION_NOT_ALLOWED");
  }

  if (
    current === "REQUESTED" &&
    target === "SUBMITTING" &&
    authority.kind === "SUBMIT_COMMAND"
  ) {
    return appliedTransition(current, target, "REFUND_SUBMISSION_STARTED", [
      { type: "REFUND_STATUS_CHANGED" },
    ]);
  }
  if (target === "UNKNOWN") {
    return authority.kind === "NETWORK_UNCERTAINTY" &&
      authority.operationMayHaveCommitted
      ? appliedTransition(
          current,
          target,
          "REFUND_RESULT_UNCERTAIN",
          refundEffects(target),
        )
      : rejectedTransition(
          current,
          target,
          "REFUND_UNCERTAINTY_NOT_ESTABLISHED",
        );
  }
  if (authority.kind !== "PROVIDER_EVIDENCE") {
    return rejectedTransition(
      current,
      target,
      "REFUND_PROVIDER_EVIDENCE_REQUIRED",
    );
  }
  if (!hasAcceptedRefundEvidence(authority)) {
    return rejectedTransition(
      current,
      target,
      "REFUND_PROVIDER_EVIDENCE_INVALID",
    );
  }
  if (!hasMatchingRefundEvidence(authority, target)) {
    return rejectedTransition(
      current,
      target,
      "REFUND_EVIDENCE_STATUS_MISMATCH",
    );
  }

  return appliedTransition(
    current,
    target,
    "REFUND_PROVIDER_STATUS_CONFIRMED",
    refundEffects(target),
  );
}
