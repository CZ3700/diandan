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
  AIRWALLEX_ADAPTER_KEY,
  AIRWALLEX_ADAPTER_VERSION,
  AIRWALLEX_PROTOCOL,
  parseAirwallexConnection,
} from "./connection.js";
import { createAirwallexPaymentProvider } from "./provider.js";
import { createAirwallexSession, type AirwallexSession } from "./session.js";
import { createAirwallexTransport } from "./transport.js";
import { createAirwallexWebhookVerifier } from "./webhook.js";

export type AirwallexAdapterOptions = Readonly<{
  credentials: PaymentCredentialResolver;
  fetch?: typeof fetch;
  now?: () => Date;
}>;

export type AirwallexAdapter = Readonly<{
  connector: PaymentConnectorFactory;
  createWebhookVerifier(
    configuration: PaymentGatewayWebhookConfig,
    connection: PaymentAccountConnection,
  ): PaymentWebhookVerifier;
}>;

/**
 * Compiled Airwallex Hosted Payment Page code. The descriptor promises durable idempotency
 * because the provider finds existing intents and refunds before it creates anything.
 */
export function createAirwallexAdapter(
  options: AirwallexAdapterOptions,
): AirwallexAdapter {
  const transport = createAirwallexTransport(options.fetch);
  const now = options.now ?? (() => new Date());
  // A republished configuration recreates providers; the account's token survives it.
  const sessions = new Map<string, AirwallexSession>();
  const sessionFor = (connection: PaymentAccountConnection) => {
    const key = JSON.stringify([
      connection.binding.providerAccountId.toLowerCase(),
      connection.binding.environment,
      connection.apiOrigin,
      connection.credentialRef,
    ]);
    let session = sessions.get(key);
    if (session === undefined) {
      session = createAirwallexSession({
        connection,
        credentials: options.credentials,
        transport,
        now,
      });
      sessions.set(key, session);
    }
    return session;
  };
  const connector: PaymentConnectorFactory = Object.freeze({
    descriptor: deployedPaymentAdapterSchema.parse({
      schemaVersion: 1,
      adapterKey: AIRWALLEX_ADAPTER_KEY,
      adapterVersion: AIRWALLEX_ADAPTER_VERSION,
      protocol: AIRWALLEX_PROTOCOL,
      supportedOperations: [...PAYMENT_PROVIDER_OPERATIONS],
      supportedInstrumentKinds: ["CARD"],
      idempotency: {
        retention: "DURABLE",
        minimumRetentionSeconds: 0,
        referenceLookup: true,
      },
    }),
    create(input: PaymentAccountConnection) {
      const connection = parseAirwallexConnection(input);
      return {
        configuration: connection.binding,
        provider: createAirwallexPaymentProvider({
          connection,
          credentials: options.credentials,
          transport,
          session: sessionFor(connection),
          now,
        }),
      };
    },
  });
  return Object.freeze({
    connector,
    createWebhookVerifier(configuration, input) {
      return createAirwallexWebhookVerifier({
        configuration,
        connection: parseAirwallexConnection(input),
        credentials: options.credentials,
      });
    },
  });
}
