import {
  loadPaymentWebhookEndpointCommandSchema,
  loadPaymentWebhookEndpointResponseSchema,
} from "@fan-support/contracts";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

const preflightCommandSchema = loadPaymentWebhookEndpointCommandSchema.omit({
  operation: true,
});

export type PaymentWebhookEndpointPreflightResult = Readonly<{
  schemaVersion: 1;
  outcome:
    "ELIGIBLE" | "UNAVAILABLE" | "INVALID_REQUEST" | "TEMPORARY_UNAVAILABLE";
}>;

export type PaymentWebhookEndpointPreflightDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
}>;

export function createPaymentWebhookEndpointPreflight(
  dependencies: PaymentWebhookEndpointPreflightDependencies,
): (command: unknown) => Promise<PaymentWebhookEndpointPreflightResult> {
  return async (command) => {
    const parsedCommand = preflightCommandSchema.safeParse(command);
    if (!parsedCommand.success) {
      return Object.freeze({ schemaVersion: 1, outcome: "INVALID_REQUEST" });
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
        return Object.freeze({
          schemaVersion: 1,
          outcome: "TEMPORARY_UNAVAILABLE",
        });
      }
      if (
        parsed.data.value.decision === "ELIGIBLE" &&
        parsed.data.value.endpoint.endpointId !== parsedCommand.data.endpointId
      ) {
        return Object.freeze({
          schemaVersion: 1,
          outcome: "TEMPORARY_UNAVAILABLE",
        });
      }
      return Object.freeze({
        schemaVersion: 1,
        outcome: parsed.data.value.decision,
      });
    } catch {
      return Object.freeze({
        schemaVersion: 1,
        outcome: "TEMPORARY_UNAVAILABLE",
      });
    }
  };
}
