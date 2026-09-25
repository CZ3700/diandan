import {
  persistencePortCommandSchema,
  type CheckoutPreflightCommitCommand,
  type CheckoutPreflightConsent,
} from "@fan-support/contracts";
import type { CheckoutPreflightRepositories } from "@fan-support/persistence-port";
import {
  checkoutPersistenceSuccess,
  rejectCheckout,
} from "./checkout-transaction.js";

/** Initial fulfillment events use the established durable event port in the order transaction. */
export async function appendCheckoutFulfillmentEvents(
  repos: CheckoutPreflightRepositories,
  commit: CheckoutPreflightCommitCommand,
  consent: CheckoutPreflightConsent,
  occurredAt: string,
): Promise<void> {
  for (const item of commit.items) {
    const command = persistencePortCommandSchema.parse({
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      event: {
        schemaVersion: 1,
        eventId: item.fulfillmentEventId,
        eventType: "FULFILLMENT_STATUS_CHANGED",
        aggregateId: item.fulfillmentId,
        requestId: commit.requestId,
        correlationId: commit.correlationId,
        occurredAt,
        payload: {
          fulfillmentId: item.fulfillmentId,
          orderId: commit.orderId,
          status: "PENDING",
        },
      },
      aggregateVersion: 1,
      primarySubjectId: item.fulfillmentId,
      secondarySubjectId: commit.orderId,
      market: consent.market,
      currency: consent.currency,
      idempotencyKey: `checkout.fulfillment.created:${item.fulfillmentId}`,
      availableAt: occurredAt,
    });
    if (command.operation !== "APPEND_OUTBOX_EVENT")
      return rejectCheckout("TEMPORARY_UNAVAILABLE");
    const result = checkoutPersistenceSuccess(
      await repos.outbox.append(command),
    );
    if (
      result.operation !== "APPEND_OUTBOX_EVENT" ||
      result.value.eventId !== command.event.eventId
    )
      return rejectCheckout("TEMPORARY_UNAVAILABLE");
  }
}
