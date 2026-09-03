import {
  loadPaymentWebhookEndpointResponseSchema,
  paymentWebhookEndpointPreflightCommandSchema,
  paymentWebhookEndpointPreflightResultSchema,
  type PaymentWebhookEndpointPreflightResult,
} from "@fan-support/contracts";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

export type { PaymentWebhookEndpointPreflightResult } from "@fan-support/contracts";

export type PaymentWebhookEndpointPreflightDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
}>;

function preflightResult(
  outcome: PaymentWebhookEndpointPreflightResult["outcome"],
): PaymentWebhookEndpointPreflightResult {
  return Object.freeze(
    paymentWebhookEndpointPreflightResultSchema.parse({
      schemaVersion: 1,
      outcome,
    }),
  );
}

export function createPaymentWebhookEndpointPreflight(
  dependencies: PaymentWebhookEndpointPreflightDependencies,
): (command: unknown) => Promise<PaymentWebhookEndpointPreflightResult> {
  return async (command) => {
    const parsedCommand =
      paymentWebhookEndpointPreflightCommandSchema.safeParse(command);
    if (!parsedCommand.success) {
      return preflightResult("INVALID_REQUEST");
    }
    try {
      const result =
        await dependencies.transactionManager.runInReliableEventTransaction(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          (repositories) =>
            repositories.paymentWebhookEndpoints.load({
              schemaVersion: 1,
              operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
              endpointId: parsedCommand.data.endpointId,
              receivedAt: parsedCommand.data.receivedAt,
            }),
        );
      const parsed = loadPaymentWebhookEndpointResponseSchema.safeParse(result);
      if (!parsed.success) {
        return preflightResult("TEMPORARY_UNAVAILABLE");
      }
      if (
        parsed.data.value.decision === "ELIGIBLE" &&
        parsed.data.value.endpoint.endpointId !== parsedCommand.data.endpointId
      ) {
        return preflightResult("TEMPORARY_UNAVAILABLE");
      }
      return preflightResult(parsed.data.value.decision);
    } catch {
      return preflightResult("TEMPORARY_UNAVAILABLE");
    }
  };
}
