import {
  deployedPaymentAdapterSchema,
  type PaymentAccountConnection,
  type PaymentGatewayWebhookConfig,
} from "@fan-support/contracts";
import {
  PAYMENT_PROVIDER_OPERATIONS,
  type PaymentConnectorFactory,
  type PaymentCredentialResolver,
  type PaymentWebhookVerifier,
} from "@fan-support/payment-port";

import {
  STRIPE_ADAPTER_KEY,
  STRIPE_ADAPTER_VERSION,
  STRIPE_PROTOCOL,
  parseStripeConnection,
} from "./connection.js";
import { createStripePaymentProvider } from "./provider.js";
import { createStripeTransport } from "./transport.js";
import { createStripeWebhookVerifier } from "./webhook.js";

export type StripeAdapterOptions = Readonly<{
  credentials: PaymentCredentialResolver;
  fetch?: typeof fetch;
  now?: () => Date;
}>;

export type StripeAdapter = Readonly<{
  connector: PaymentConnectorFactory;
  createWebhookVerifier(
    configuration: PaymentGatewayWebhookConfig,
    connection: PaymentAccountConnection,
  ): PaymentWebhookVerifier;
}>;

/**
 * Compiled Stripe Checkout code. The descriptor promises durable idempotency because the
 * provider looks existing objects up by platform metadata before it creates anything.
 */
export function createStripeAdapter(
  options: StripeAdapterOptions,
): StripeAdapter {
  const transport = createStripeTransport(options.fetch);
  const connector: PaymentConnectorFactory = Object.freeze({
    descriptor: deployedPaymentAdapterSchema.parse({
      schemaVersion: 1,
      adapterKey: STRIPE_ADAPTER_KEY,
      adapterVersion: STRIPE_ADAPTER_VERSION,
      protocol: STRIPE_PROTOCOL,
      supportedOperations: [...PAYMENT_PROVIDER_OPERATIONS],
      supportedInstrumentKinds: ["CARD"],
      idempotency: {
        retention: "DURABLE",
        minimumRetentionSeconds: 0,
        referenceLookup: true,
      },
    }),
    create(input: PaymentAccountConnection) {
      const connection = parseStripeConnection(input);
      return {
        configuration: connection.binding,
        provider: createStripePaymentProvider({
          connection,
          credentials: options.credentials,
          transport,
          ...(options.now ? { now: options.now } : {}),
        }),
      };
    },
  });
  return Object.freeze({
    connector,
    createWebhookVerifier(configuration, input) {
      return createStripeWebhookVerifier({
        configuration,
        connection: parseStripeConnection(input),
        credentials: options.credentials,
        transport,
      });
    },
  });
}
