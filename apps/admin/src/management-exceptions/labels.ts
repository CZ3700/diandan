import type {
  AdminExceptionAction,
  AdminExceptionItem,
  AdminExceptionTarget,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { ExceptionsCopy } from "./copy";
import { exceptionAccessLost, uncertainExceptionResult } from "./state";
export function categoryLabel(
  kind: AdminExceptionTarget["kind"],
  c: ExceptionsCopy,
) {
  return {
    WEBHOOK: c.webhook,
    DEAD_LETTER: c.deadLetter,
    PAYMENT: c.payment,
    NOTIFICATION: c.notification,
  }[kind];
}
export function actionLabel(action: AdminExceptionAction, c: ExceptionsCopy) {
  return {
    REPLAY_WEBHOOK: c.replay,
    RETRY_DEAD_LETTER: c.retryDeadLetter,
    RECONCILE_PAYMENT: c.reconcile,
    RETRY_NOTIFICATION: c.retryNotification,
  }[action];
}
export function nextStep(item: AdminExceptionItem, c: ExceptionsCopy) {
  if (item.allowedAction)
    return {
      REPLAY_WEBHOOK: c.replayHint,
      RETRY_DEAD_LETTER: c.deadLetterHint,
      RECONCILE_PAYMENT: c.reconcileHint,
      RETRY_NOTIFICATION: c.notificationHint,
    }[item.allowedAction];
  return {
    NONE: c.inconsistent,
    READ_ONLY: c.readOnly,
    IN_PROGRESS: c.inProgress,
    ALREADY_COMPLETE: c.complete,
    MANUAL_REVIEW_REQUIRED: c.manualReview,
    UNSUPPORTED_CONSUMER: c.unsupported,
    NOTIFICATION_UNCERTAIN: c.notificationUncertain,
    NOTIFICATION_EXPIRED: c.notificationExpired,
    NOTIFICATION_SUPERSEDED: c.notificationSuperseded,
    NOT_RETRYABLE: c.notRetryable,
    SOURCE_INCONSISTENT: c.inconsistent,
  }[item.blockedReason];
}
export function statusLabel(status: string, c: ExceptionsCopy) {
  const labels: Record<string, string> = {
    PENDING: c.pending,
    PROCESSING: c.processing,
    FAILED: c.failed,
    UNKNOWN: c.unknown,
    SUCCEEDED: c.succeeded,
    REVIEW: c.review,
    EXPIRED: c.expired,
    REQUESTED: c.requested,
  };
  return labels[status] ?? c.review;
}
export function exceptionError(
  error: unknown,
  c: ExceptionsCopy,
  hasPendingRequest = false,
) {
  if (exceptionAccessLost(error)) return c.forbidden;
  if (
    error instanceof AdminClientError &&
    [
      "STALE_VERSION",
      "IDEMPOTENCY_CONFLICT",
      "CONFLICT",
      "TRANSITION_NOT_ALLOWED",
      "SOURCE_IN_PROGRESS",
      "NOTIFICATION_NOT_READY",
      "NOTIFICATION_IN_PROGRESS",
    ].includes(error.code)
  )
    return c.conflict;
  return hasPendingRequest && uncertainExceptionResult(error)
    ? c.uncertain
    : c.error;
}
