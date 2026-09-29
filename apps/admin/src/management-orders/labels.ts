import type { OrdersCopy } from "./copy";
import { AdminClientError } from "../workspace/client";
export function orderStatusLabel(status: string, copy: OrdersCopy): string {
  switch (status) {
    case "PENDING":
      return copy.pending;
    case "PREPARING":
      return copy.preparing;
    case "DELIVERED":
      return copy.delivered;
    case "ON_HOLD":
      return copy.onHold;
    case "CANCELED":
      return copy.canceled;
    case "UNPAID":
      return copy.unpaid;
    case "PAID":
      return copy.paid;
    case "PARTIALLY_REFUNDED":
      return copy.partiallyRefunded;
    case "REFUNDED":
      return copy.refunded;
    case "APPROVED":
      return copy.approved;
    case "REJECTED":
      return copy.rejected;
    case "REDACTED":
      return copy.redacted;
    case "SENT":
      return copy.notificationSent;
    case "FAILED":
      return copy.notificationFailed;
    case "UNKNOWN":
      return copy.notificationUnknown;
    case "REQUESTED":
    case "PROCESSING":
    case "RETRY_SCHEDULED":
      return copy.notificationWaiting;
    default:
      return copy.unavailable;
  }
}
/** Colour tones for handling delivery (user request 2026-09-29). */
export type StatusTone =
  "attention" | "progress" | "success" | "danger" | "neutral";
export function fulfillmentTone(status: string): StatusTone {
  switch (status) {
    case "PENDING":
      return "attention";
    case "PREPARING":
      return "progress";
    case "DELIVERED":
      return "success";
    case "ON_HOLD":
      return "danger";
    default:
      return "neutral";
  }
}
export function paymentTone(status: string): StatusTone {
  switch (status) {
    case "UNPAID":
    case "PENDING":
      return "attention";
    case "PAID":
      return "success";
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return "danger";
    default:
      return "neutral";
  }
}
/** A payment still pending reads "awaiting payment", never the fulfilment "pending". */
export function paymentStatusLabel(status: string, copy: OrdersCopy): string {
  return status === "PENDING"
    ? copy.paymentPending
    : orderStatusLabel(status, copy);
}
export function ordersError(error: unknown, copy: OrdersCopy): string {
  const code = error instanceof AdminClientError ? error.code : "";
  switch (code) {
    case "STALE_VERSION":
    case "IDEMPOTENCY_CONFLICT":
    case "CONFLICT":
      return copy.conflict;
    case "FORBIDDEN":
    case "UNAUTHENTICATED":
    case "CSRF_INVALID":
      return copy.forbidden;
    case "PAYMENT_NOT_CONFIRMED":
      return copy.paymentRequired;
    case "MODERATION_REQUIRED":
      return copy.moderationRequired;
    case "LANGUAGE_REVIEW_REQUIRED":
      return copy.languageRequired;
    case "PRIVATE_ACCESS_EXPIRED":
      return copy.privateExpired;
    case "PRIVATE_CONTENT_UNAVAILABLE":
      return copy.unavailable;
    case "RATE_LIMITED":
      return copy.throttled;
    case "NOTIFICATION_NOT_READY":
    case "NOTIFICATION_IN_PROGRESS":
      return copy.notificationWaiting;
    case "PROOF_INVALID":
      return copy.proofInvalid;
    case "PROOF_LIMIT_REACHED":
      return copy.proofLimit;
    default:
      return copy.failure;
  }
}
