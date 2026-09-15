import { randomUUID } from "node:crypto";
import { orderPaymentApplyCommandSchema } from "@fan-support/contracts";
import type { WebhookInboxHandler } from "./process-webhook-inbox.js";
import {
  applyOrderPaymentInTransaction,
  OrderPaymentApplicationError,
} from "./order-payment-application.js";

/** Registered only for PAYMENT_STATUS; receipt and aggregate share the inbox transaction. */
export function createOrderPaymentWebhookHandler(
  createId: () => string = randomUUID,
): WebhookInboxHandler {
  return Object.freeze({
    effect: (context) => ({
      effectKey: "ORDER_PAYMENT_APPLICATION",
      subjectId: context.providerEventRowId,
    }),
    handle: async (context, repositories) => {
      if (
        context.event.eventType !== "PAYMENT_STATUS" ||
        !repositories.orderPaymentApplication
      )
        throw new OrderPaymentApplicationError("PERSISTENCE_FAILURE");
      const result = await applyOrderPaymentInTransaction(
        repositories.orderPaymentApplication,
        orderPaymentApplyCommandSchema.parse({
          schemaVersion: 1,
          providerEventId: context.providerEventRowId,
          requestId: createId(),
          correlationId: createId(),
          taskName: "order-payment-webhook",
        }),
      );
      if (result.decision === "UNMATCHED")
        throw new OrderPaymentApplicationError("EVIDENCE_UNMATCHED");
    },
  });
}
