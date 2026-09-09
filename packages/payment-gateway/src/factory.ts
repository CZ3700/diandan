import type { PaymentConnectorFactory } from "./registry.js";
import type { GatewayCredentialResolver } from "./credentials.js";
import { createGatewayPaymentProvider } from "./client.js";
import { deployedPaymentAdapterSchema } from "@fan-support/contracts";
import { PAYMENT_PROVIDER_OPERATIONS } from "@fan-support/payment-port";

/** Compiled protocol implementation; descriptors and credentials do not authorize a merchant. */
export function createNormalizedGatewayFactory(
  credentials: GatewayCredentialResolver,
): PaymentConnectorFactory {
  return Object.freeze({
    descriptor: deployedPaymentAdapterSchema.parse({
      schemaVersion: 1,
      adapterKey: "normalized-gateway",
      adapterVersion: "1.0.0",
      protocol: "fan-support-gateway-v1",
      supportedOperations: [...PAYMENT_PROVIDER_OPERATIONS],
      supportedInstrumentKinds: ["CARD", "LOCAL_PAYMENT"],
      idempotency: {
        retention: "DURABLE",
        minimumRetentionSeconds: 0,
        referenceLookup: true,
      },
    }),
    create(connection) {
      return {
        configuration: connection.binding,
        provider: createGatewayPaymentProvider({ connection, credentials }),
      };
    },
  });
}
