import {
  paymentWebhookEndpointIdSchema,
  paymentWebhookEndpointPreflightResultSchema,
} from "@fan-support/contracts";
import type { PaymentWebhookVerifier } from "@fan-support/payment-port";

import type { PaymentWebhookRouteOptions } from "./payment-webhook-route.js";

export type PaymentWebhookVerifierRegistration = Readonly<{
  adapterKey: string;
  endpointId: string;
  verifier: PaymentWebhookVerifier;
}>;

export type PaymentWebhookVerifierDirectory = Readonly<{
  verifierForEndpoint(
    adapterKey: string,
    endpointId: string,
  ): PaymentWebhookVerifier | undefined;
  /** Rejects endpoints without deployed verification code in memory, before any database round trip. */
  gate(route: PaymentWebhookRouteOptions): PaymentWebhookRouteOptions;
}>;

const UNAVAILABLE = Object.freeze(
  paymentWebhookEndpointPreflightResultSchema.parse({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  }),
);

/** Static, endpoint-scoped verification code. The PostgreSQL endpoint row still decides eligibility. */
export function createPaymentWebhookVerifierDirectory(
  registrations: readonly PaymentWebhookVerifierRegistration[],
): PaymentWebhookVerifierDirectory {
  const byEndpoint = new Map<string, PaymentWebhookVerifierRegistration>();
  for (const registration of registrations) {
    const endpointId = paymentWebhookEndpointIdSchema.parse(
      registration.endpointId,
    );
    if (
      byEndpoint.has(endpointId) ||
      typeof registration.verifier?.verifyPaymentWebhook !== "function"
    )
      throw new TypeError("Invalid payment webhook verifier registration");
    byEndpoint.set(endpointId, Object.freeze({ ...registration, endpointId }));
  }
  return Object.freeze({
    verifierForEndpoint(adapterKey: string, endpointId: string) {
      const registration = byEndpoint.get(endpointId);
      return registration?.adapterKey === adapterKey
        ? registration.verifier
        : undefined;
    },
    gate(route: PaymentWebhookRouteOptions): PaymentWebhookRouteOptions {
      return Object.freeze({
        ...route,
        endpointPreflight: async (command) =>
          byEndpoint.has(command.endpointId)
            ? route.endpointPreflight(command)
            : UNAVAILABLE,
      });
    },
  });
}
