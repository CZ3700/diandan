import {
  paymentIntentIdOf,
  type StripeDispute,
  type StripeRefund,
  type StripeSession,
} from "./stripe-objects.js";

export type SessionObservation =
  | Readonly<{ status: "REQUIRES_ACTION"; redirectUrl: string }>
  | Readonly<{ status: "PROCESSING" }>
  | Readonly<{ status: "SUCCEEDED"; paymentIntentId: string }>
  | Readonly<{ status: "EXPIRED" }>;

/**
 * A card failure inside Checkout is not terminal: the fan can retry on the same page, so only
 * the end of the session produces EXPIRED. Contradictory combinations return undefined; the
 * caller treats them as malformed instead of guessing.
 */
export function observeSession(
  session: StripeSession,
): SessionObservation | undefined {
  const intent =
    typeof session.payment_intent === "object" &&
    session.payment_intent !== null
      ? session.payment_intent
      : undefined;
  const intentId = paymentIntentIdOf(session);
  switch (session.status) {
    case "open":
      if (session.payment_status !== "unpaid") return undefined;
      if (intent?.status === "processing") return { status: "PROCESSING" };
      if (intent?.status === "succeeded" || intent?.status === "canceled")
        return undefined;
      return typeof session.url === "string"
        ? { status: "REQUIRES_ACTION", redirectUrl: session.url }
        : undefined;
    case "complete":
      if (session.payment_status === "unpaid") return { status: "PROCESSING" };
      if (
        session.payment_status !== "paid" ||
        intentId === undefined ||
        (intent !== undefined && intent.status !== "succeeded")
      )
        return undefined;
      return { status: "SUCCEEDED", paymentIntentId: intentId };
    case "expired":
      return session.payment_status === "unpaid"
        ? { status: "EXPIRED" }
        : undefined;
  }
}

export function refundStatusOf(
  refund: StripeRefund,
): "PROCESSING" | "SUCCEEDED" | "FAILED" {
  switch (refund.status) {
    case "pending":
    case "requires_action":
      return "PROCESSING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
    case "canceled":
      return "FAILED";
  }
}

export function disputeStatusOf(
  dispute: StripeDispute,
): "OPEN" | "WON" | "LOST" {
  switch (dispute.status) {
    case "warning_needs_response":
    case "warning_under_review":
    case "needs_response":
    case "under_review":
      return "OPEN";
    case "won":
    case "warning_closed":
    case "prevented":
      return "WON";
    case "lost":
      return "LOST";
  }
}
