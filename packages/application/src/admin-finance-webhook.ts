import { randomUUID } from "node:crypto";
import { adminFinanceApplyCommandSchema } from "@fan-support/contracts";
import type { WebhookInboxHandler } from "./process-webhook-inbox.js";
import { applyAdminFinanceInTransaction } from "./admin-finance-events.js";
/** Refund/dispute effects and inbox success commit atomically, while early unmatched evidence remains retryable. */
export function createAdminFinanceWebhookHandler(
  createId: () => string = randomUUID,
): WebhookInboxHandler {
  return Object.freeze({
    effect: (context) => ({
      effectKey: "ADMIN_FINANCE_APPLICATION",
      subjectId: context.providerEventRowId,
    }),
    handle: async (context, repositories) => {
      if (
        !["REFUND_STATUS", "DISPUTE_STATUS"].includes(
          context.event.eventType,
        ) ||
        !repositories.adminFinance
      )
        throw new TypeError("Finance webhook repository unavailable");
      const result = await applyAdminFinanceInTransaction(
        repositories.adminFinance,
        adminFinanceApplyCommandSchema.parse({
          schemaVersion: 1,
          providerEventId: context.providerEventRowId,
          requestId: createId(),
          correlationId: createId(),
          taskName: "admin-finance-webhook",
        }),
      );
      if (result.decision === "UNMATCHED")
        throw new TypeError("Unmatched finance evidence");
    },
  });
}
