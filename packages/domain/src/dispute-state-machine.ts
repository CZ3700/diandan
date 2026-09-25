import type { Dispute } from "@fan-support/contracts";

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
} from "./transition-decision.js";

export type DisputeStatus = Dispute["status"];

export type DisputeTransitionAuthority =
  | Readonly<{
      kind: "PROVIDER_EVIDENCE";
      expectedPaymentAttemptId: string;
      expectedProviderReference: string;
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{ kind: "BROWSER_RETURN" }>;

const TERMINAL_DISPUTE_STATUSES = new Set<DisputeStatus>(["WON", "LOST"]);

const DISPUTE_TRANSITIONS: Readonly<
  Record<DisputeStatus, readonly DisputeStatus[]>
> = {
  NONE: ["OPEN", "WON", "LOST"],
  OPEN: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

export function decideDisputeTransition(
  current: DisputeStatus,
  target: DisputeStatus,
  authority: DisputeTransitionAuthority,
): TransitionDecision<DisputeStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (TERMINAL_DISPUTE_STATUSES.has(current)) {
    return conflictingTransition(
      current,
      target,
      "DISPUTE_TERMINAL_STATE_CONFLICT",
    );
  }
  if (!DISPUTE_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(
      current,
      target,
      "DISPUTE_TRANSITION_NOT_ALLOWED",
    );
  }
  if (authority.kind !== "PROVIDER_EVIDENCE") {
    return rejectedTransition(
      current,
      target,
      "DISPUTE_PROVIDER_EVIDENCE_REQUIRED",
    );
  }
  if (
    !isAcceptedProviderEvidenceFor(authority.evidence, {
      eventType: "DISPUTE_STATUS",
      expectedPaymentAttemptId: authority.expectedPaymentAttemptId,
      expectedProviderReference: authority.expectedProviderReference,
    })
  ) {
    return rejectedTransition(
      current,
      target,
      "DISPUTE_PROVIDER_EVIDENCE_INVALID",
    );
  }
  if (
    authority.evidence.eventType !== "DISPUTE_STATUS" ||
    authority.evidence.status !== target
  ) {
    return rejectedTransition(
      current,
      target,
      "DISPUTE_EVIDENCE_STATUS_MISMATCH",
    );
  }

  return appliedTransition(
    current,
    target,
    "DISPUTE_PROVIDER_STATUS_CONFIRMED",
    [{ type: "DISPUTE_STATUS_CHANGED" }],
  );
}
