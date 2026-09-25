import { AdminClientError } from "../workspace/client";
import type { FinanceCopy } from "./copy";
export function financeStatus(status: string, copy: FinanceCopy): string {
  const labels: Record<string, string> = {
    OPEN: copy.open,
    WON: copy.won,
    LOST: copy.lost,
    NONE: copy.none,
    REQUESTED: copy.requested,
    SUBMITTING: copy.submitting,
    PROCESSING: copy.processing,
    SUCCEEDED: copy.succeeded,
    UNKNOWN: copy.unknown,
    FAILED: copy.failedStatus,
    CANCELED: copy.canceled,
    EXPIRED: copy.expired,
    CREATED: copy.created,
    REQUIRES_ACTION: copy.requiresAction,
    PAID: copy.paid,
    UNPAID: copy.unpaid,
    PENDING: copy.processing,
    PARTIALLY_REFUNDED: copy.partiallyRefunded,
    REFUNDED: copy.refundedStatus,
  };
  return labels[status] ?? copy.unknown;
}
export function financeError(error: unknown, copy: FinanceCopy): string {
  const code = error instanceof AdminClientError ? error.code : "";
  if (["FORBIDDEN", "UNAUTHENTICATED", "CSRF_INVALID"].includes(code))
    return copy.forbidden;
  if (["STALE_VERSION", "IDEMPOTENCY_CONFLICT", "CONFLICT"].includes(code))
    return copy.conflict;
  if (
    [
      "REFUND_CAPACITY_EXCEEDED",
      "REFUND_ITEM_CAPACITY_EXCEEDED",
      "INVALID_COMMAND",
      "CURRENCY_MISMATCH",
    ].includes(code)
  )
    return copy.invalid;
  if (code === "RECONCILIATION_REQUIRED") return copy.pendingHint;
  if (code === "DISPUTE_REQUIRES_REVIEW") return copy.disputeHold;
  return uncertainFinanceResult(error) ? copy.uncertain : copy.failed;
}
export function uncertainFinanceResult(error: unknown): boolean {
  return (
    !(error instanceof AdminClientError) ||
    [
      "NETWORK_ERROR",
      "INVALID_RESPONSE",
      "TEMPORARY_UNAVAILABLE",
      "CONTENT_UNAVAILABLE",
    ].includes(error.code)
  );
}
