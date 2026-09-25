import {
  financeEvidenceInputSchema,
  financeEvidenceDecisionSchema,
  financeDisputeProjectionInputSchema,
  financeDisputeProjectionSchema,
  type FinanceEvidenceDecision,
  type FinanceEvidenceInput,
} from "@fan-support/contracts";
import { validateProviderEvidence } from "./provider-evidence.js";
import { decideRefundTransition } from "./refund-state-machine.js";
import { decideDisputeTransition } from "./dispute-state-machine.js";
function decision(
  kind: FinanceEvidenceDecision["decision"],
  reasonCode: string,
  targetStatus: FinanceEvidenceDecision["targetStatus"] = null,
): FinanceEvidenceDecision {
  return financeEvidenceDecisionSchema.parse({
    schemaVersion: 1,
    decision: kind,
    reasonCode,
    targetStatus,
  });
}
function target(value: FinanceEvidenceInput) {
  return {
    paymentAttemptId: value.target.paymentAttemptId,
    providerAccountId: value.target.providerAccountId,
    environment: value.target.environment,
    externalReference: value.target.externalReference,
    providerReference: value.target.providerReference,
    amountMinor: value.target.amountMinor,
    currency: value.target.currency,
    eventType:
      value.kind === "REFUND"
        ? ("REFUND_STATUS" as const)
        : ("DISPUTE_STATUS" as const),
  };
}
/** Orders provider evidence after durable ingress authentication; never invents a missing intermediate provider event. */
export function decideFinanceEvidence(input: unknown): FinanceEvidenceDecision {
  const parsed = financeEvidenceInputSchema.safeParse(input);
  if (!parsed.success) return decision("REVIEW", "FINANCE_EVIDENCE_INVALID");
  const value = parsed.data;
  if (value.target.amountMinor > value.target.capturedAmountMinor)
    return decision("REVIEW", "FINANCE_AMOUNT_EXCEEDS_CAPTURE");
  const validated = validateProviderEvidence(target(value), value.event);
  if (validated.decision !== "ACCEPTED")
    return decision("REVIEW", validated.reasonCode);
  const authority = {
    kind: "PROVIDER_EVIDENCE" as const,
    expectedPaymentAttemptId: value.target.paymentAttemptId,
    expectedProviderReference: value.target.providerReference,
    evidence: validated.evidence,
  };
  if (value.kind === "REFUND" && value.event.eventType === "REFUND_STATUS") {
    const status = value.event.status;
    if (!["PROCESSING", "SUCCEEDED", "FAILED"].includes(status))
      return decision("REVIEW", "REFUND_PROVIDER_STATUS_INVALID");
    if (status === "SUCCEEDED" && value.event.transaction?.type !== "REFUND")
      return decision("REVIEW", "REFUND_TRANSACTION_REQUIRED");
    if (value.currentStatus === "REQUESTED")
      return decision("WAIT", "REFUND_SUBMISSION_PENDING");
    if (value.currentStatus === status)
      return decision("IGNORE", "FINANCE_ALREADY_APPLIED");
    if (
      ["SUCCEEDED", "FAILED"].includes(value.currentStatus) &&
      status === "PROCESSING"
    )
      return decision("IGNORE", "FINANCE_STALE_PROGRESS");
    const next = decideRefundTransition(value.currentStatus, status, authority);
    return next.decision === "APPLIED"
      ? decision("APPLY", next.reasonCode, status)
      : decision("REVIEW", next.reasonCode);
  }
  if (value.kind === "DISPUTE" && value.event.eventType === "DISPUTE_STATUS") {
    const status = value.event.status;
    if (value.currentStatus === status)
      return decision("IGNORE", "FINANCE_ALREADY_APPLIED");
    if (["WON", "LOST"].includes(value.currentStatus) && status === "OPEN")
      return decision("IGNORE", "FINANCE_STALE_PROGRESS");
    const next = decideDisputeTransition(
      value.currentStatus,
      status,
      authority,
    );
    return next.decision === "APPLIED"
      ? decision("APPLY", next.reasonCode, status)
      : decision("REVIEW", next.reasonCode);
  }
  return decision("REVIEW", "PROVIDER_EVENT_TYPE_MISMATCH");
}
/** Different disputes may coexist: unresolved/lost disputes cannot disappear behind a won dispute. */
export function projectFinanceDisputeStatus(input: unknown) {
  const { statuses } = financeDisputeProjectionInputSchema.parse(input);
  let status: "NONE" | "OPEN" | "WON" | "LOST" = "NONE";
  if (statuses.includes("LOST")) status = "LOST";
  else if (statuses.includes("OPEN")) status = "OPEN";
  else if (statuses.length > 0) status = "WON";
  return financeDisputeProjectionSchema.parse({ schemaVersion: 1, status });
}
