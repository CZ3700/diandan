import type { AirwallexDispute, AirwallexRefund } from "./airwallex-objects.js";

export type IntentObservation =
  "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "CANCELED";

/**
 * A declined card inside the Hosted Payment Page returns the intent to REQUIRES_PAYMENT_METHOD,
 * so a failure is never terminal here. REQUIRES_CAPTURE cannot occur with automatic capture;
 * it and any status added later return undefined, which callers treat as malformed.
 */
export function observeIntentStatus(
  status: string,
): IntentObservation | undefined {
  switch (status) {
    case "REQUIRES_PAYMENT_METHOD":
    case "REQUIRES_CUSTOMER_ACTION":
      return "REQUIRES_ACTION";
    case "PENDING":
    case "PENDING_REVIEW":
      return "PROCESSING";
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "CANCELLED":
      return "CANCELED";
    default:
      return undefined;
  }
}

/** ACCEPTED means the payment method provider accepted the refund; Airwallex calls it complete. */
export function refundStatusOf(
  refund: AirwallexRefund,
): "PROCESSING" | "SUCCEEDED" | "FAILED" {
  switch (refund.status) {
    case "RECEIVED":
      return "PROCESSING";
    case "ACCEPTED":
    case "SETTLED":
      return "SUCCEEDED";
    case "FAILED":
      return "FAILED";
  }
}

/** An expired request for information is still unresolved: the issuer may escalate it. */
export function disputeStatusOf(
  dispute: AirwallexDispute,
): "OPEN" | "WON" | "LOST" {
  switch (dispute.status) {
    case "REQUIRES_RESPONSE":
    case "CHALLENGED":
    case "PENDING_CLOSURE":
    case "PENDING_DECISION":
    case "EXPIRED":
      return "OPEN";
    case "WON":
    case "REVERSED":
      return "WON";
    case "ACCEPTED":
    case "LOST":
      return "LOST";
  }
}
