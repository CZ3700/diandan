import { auditLogIdSchema, type Order } from "@fan-support/contracts";

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

export type OrderLifecycleStatus = Order["orderStatus"];
export type OrderPaymentStatus = Order["paymentStatus"];

export type OrderLifecycleAuthority =
  | Readonly<{ kind: "CHECKOUT_CREATED" }>
  | Readonly<{
      kind: "PROVIDER_EVIDENCE";
      expectedPaymentAttemptId: string;
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{
      kind: "AUDITED_BUSINESS_CANCEL";
      auditLogId: string;
      reasonCode: string;
    }>
  | Readonly<{ kind: "FULFILLMENT_COMPLETED" }>
  | Readonly<{ kind: "HTTP_TIMEOUT" }>;

export type OrderPaymentAuthority =
  | Readonly<{ kind: "ATTEMPT_CREATED" }>
  | Readonly<{
      kind: "PROVIDER_EVIDENCE";
      expectedPaymentAttemptId: string;
      evidence: AcceptedProviderEvidence;
    }>
  | Readonly<{
      kind: "REFUND_TOTALS";
      capturedAmountMinor: number;
      succeededRefundAmountMinor: number;
    }>;

const ORDER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<OrderLifecycleStatus, readonly OrderLifecycleStatus[]>
> = {
  DRAFT: ["PENDING_PAYMENT"],
  PENDING_PAYMENT: ["OPEN", "CANCELED"],
  OPEN: ["CLOSED"],
  CLOSED: [],
  CANCELED: [],
};

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;

const ORDER_PAYMENT_TRANSITIONS: Readonly<
  Record<OrderPaymentStatus, readonly OrderPaymentStatus[]>
> = {
  UNPAID: ["PENDING"],
  PENDING: ["PAID"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
};

function isPaymentEvidenceStatus(
  evidence: AcceptedProviderEvidence,
  statuses: readonly string[],
): boolean {
  return (
    evidence.eventType === "PAYMENT_STATUS" &&
    statuses.includes(evidence.status)
  );
}

function hasAcceptedPaymentEvidence(
  authority: Readonly<{
    expectedPaymentAttemptId: string;
    evidence: AcceptedProviderEvidence;
  }>,
): boolean {
  return isAcceptedProviderEvidenceFor(authority.evidence, {
    eventType: "PAYMENT_STATUS",
    expectedPaymentAttemptId: authority.expectedPaymentAttemptId,
  });
}

function hasValidAuditedCancel(
  authority: Extract<
    OrderLifecycleAuthority,
    { kind: "AUDITED_BUSINESS_CANCEL" }
  >,
): boolean {
  return (
    auditLogIdSchema.safeParse(authority.auditLogId).success &&
    REASON_CODE_PATTERN.test(authority.reasonCode)
  );
}

function appliedOrderLifecycle(
  current: OrderLifecycleStatus,
  target: OrderLifecycleStatus,
  reasonCode: string,
): TransitionDecision<OrderLifecycleStatus> {
  return appliedTransition(current, target, reasonCode, [
    { type: "ORDER_STATUS_CHANGED" },
  ]);
}

export function decideOrderLifecycleTransition(
  current: OrderLifecycleStatus,
  target: OrderLifecycleStatus,
  authority: OrderLifecycleAuthority,
): TransitionDecision<OrderLifecycleStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (current === "CLOSED") {
    return conflictingTransition(
      current,
      target,
      "ORDER_TERMINAL_STATE_CONFLICT",
    );
  }
  if (!ORDER_LIFECYCLE_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(current, target, "ORDER_TRANSITION_NOT_ALLOWED");
  }
  if (
    authority.kind === "PROVIDER_EVIDENCE" &&
    !hasAcceptedPaymentEvidence(authority)
  ) {
    return rejectedTransition(
      current,
      target,
      "ORDER_PROVIDER_EVIDENCE_INVALID",
    );
  }

  if (
    current === "DRAFT" &&
    target === "PENDING_PAYMENT" &&
    authority.kind === "CHECKOUT_CREATED"
  ) {
    return appliedOrderLifecycle(current, target, "ORDER_CHECKOUT_CREATED");
  }
  if (
    current === "PENDING_PAYMENT" &&
    target === "OPEN" &&
    authority.kind === "PROVIDER_EVIDENCE" &&
    isPaymentEvidenceStatus(authority.evidence, ["SUCCEEDED"])
  ) {
    return appliedOrderLifecycle(current, target, "ORDER_PAYMENT_CONFIRMED");
  }
  if (current === "PENDING_PAYMENT" && target === "CANCELED") {
    const providerCanceled =
      authority.kind === "PROVIDER_EVIDENCE" &&
      isPaymentEvidenceStatus(authority.evidence, [
        "FAILED",
        "CANCELED",
        "EXPIRED",
      ]);
    if (providerCanceled || authority.kind === "AUDITED_BUSINESS_CANCEL") {
      if (
        authority.kind === "AUDITED_BUSINESS_CANCEL" &&
        !hasValidAuditedCancel(authority)
      ) {
        return rejectedTransition(
          current,
          target,
          "ORDER_AUDITED_CANCEL_INVALID",
        );
      }
      return appliedOrderLifecycle(current, target, "ORDER_CANCELED");
    }
    return rejectedTransition(
      current,
      target,
      "ORDER_CANCELLATION_NOT_AUTHORIZED",
    );
  }
  if (
    current === "OPEN" &&
    target === "CLOSED" &&
    authority.kind === "FULFILLMENT_COMPLETED"
  ) {
    return appliedOrderLifecycle(
      current,
      target,
      "ORDER_FULFILLMENT_COMPLETED",
    );
  }
  return rejectedTransition(current, target, "ORDER_AUTHORITY_REQUIRED");
}

function expectedRefundAggregate(
  capturedAmountMinor: number,
  succeededRefundAmountMinor: number,
): "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | undefined {
  if (
    !Number.isSafeInteger(capturedAmountMinor) ||
    capturedAmountMinor <= 0 ||
    !Number.isSafeInteger(succeededRefundAmountMinor) ||
    succeededRefundAmountMinor < 0 ||
    succeededRefundAmountMinor > capturedAmountMinor
  ) {
    return undefined;
  }
  if (succeededRefundAmountMinor === 0) {
    return "PAID";
  }
  return succeededRefundAmountMinor === capturedAmountMinor
    ? "REFUNDED"
    : "PARTIALLY_REFUNDED";
}

export function decideOrderPaymentTransition(
  current: OrderPaymentStatus,
  target: OrderPaymentStatus,
  authority: OrderPaymentAuthority,
): TransitionDecision<OrderPaymentStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (current === "REFUNDED") {
    return conflictingTransition(
      current,
      target,
      "ORDER_PAYMENT_TERMINAL_STATE_CONFLICT",
    );
  }
  if (!ORDER_PAYMENT_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(
      current,
      target,
      "ORDER_PAYMENT_TRANSITION_NOT_ALLOWED",
    );
  }
  if (
    authority.kind === "PROVIDER_EVIDENCE" &&
    !hasAcceptedPaymentEvidence(authority)
  ) {
    return rejectedTransition(
      current,
      target,
      "ORDER_PROVIDER_EVIDENCE_INVALID",
    );
  }

  if (
    current === "UNPAID" &&
    target === "PENDING" &&
    authority.kind === "ATTEMPT_CREATED"
  ) {
    return appliedTransition(current, target, "ORDER_PAYMENT_ATTEMPT_CREATED", [
      { type: "ORDER_PAYMENT_STATUS_CHANGED" },
    ]);
  }
  if (
    current === "PENDING" &&
    target === "PAID" &&
    authority.kind === "PROVIDER_EVIDENCE" &&
    isPaymentEvidenceStatus(authority.evidence, ["SUCCEEDED"])
  ) {
    return appliedTransition(current, target, "ORDER_PAYMENT_CONFIRMED", [
      { type: "ORDER_PAYMENT_STATUS_CHANGED" },
    ]);
  }
  if (
    (current === "PAID" || current === "PARTIALLY_REFUNDED") &&
    authority.kind === "REFUND_TOTALS"
  ) {
    const expected = expectedRefundAggregate(
      authority.capturedAmountMinor,
      authority.succeededRefundAmountMinor,
    );
    if (expected !== target) {
      return rejectedTransition(current, target, "ORDER_REFUND_TOTAL_MISMATCH");
    }
    return appliedTransition(current, target, "ORDER_REFUND_TOTAL_CONFIRMED", [
      { type: "ORDER_PAYMENT_STATUS_CHANGED" },
    ]);
  }

  return rejectedTransition(
    current,
    target,
    "ORDER_PAYMENT_AUTHORITY_REQUIRED",
  );
}
