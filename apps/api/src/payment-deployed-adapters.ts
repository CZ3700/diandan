import type {
  PaymentAccountConnection,
  PaymentGatewayWebhookConfig,
} from "@fan-support/contracts";
import type {
  PaymentConnectorFactory,
  PaymentCredentialResolver,
  PaymentWebhookVerifier,
} from "@fan-support/payment-port";
import {
  STRIPE_ADAPTER_KEY,
  STRIPE_SIGNATURE_HEADER,
  createStripeAdapter,
} from "@fan-support/payment-stripe";

export type DeployedWebhookVerifier = Readonly<{
  verifier: PaymentWebhookVerifier;
  /** Raw headers the adapter must see; the route forwards nothing else. */
  headerNames: readonly string[];
}>;

/** Payment adapter code compiled into this release; accounts activate only through PostgreSQL publication. */
export type DeployedPaymentAdapters = Readonly<{
  connectorFactories: readonly PaymentConnectorFactory[];
  webhookVerifierFor(
    configuration: PaymentGatewayWebhookConfig,
    connection: PaymentAccountConnection,
  ): DeployedWebhookVerifier | undefined;
}>;

/**
 * V2 plan §3.1: static code, configuration activation. Stripe ships first (R1-3); Airwallex
 * and PayPal follow. TEST adapters never belong here.
 */
export function createDeployedPaymentAdapters(
  options: Readonly<{ credentials: PaymentCredentialResolver }>,
): DeployedPaymentAdapters {
  const stripe = createStripeAdapter({ credentials: options.credentials });
  return Object.freeze({
    connectorFactories: Object.freeze([stripe.connector]),
    webhookVerifierFor(configuration, connection) {
      return connection.binding.providerCode === STRIPE_ADAPTER_KEY
        ? Object.freeze({
            verifier: stripe.createWebhookVerifier(configuration, connection),
            headerNames: Object.freeze([STRIPE_SIGNATURE_HEADER]),
          })
        : undefined;
    },
  });
}

const adapterIdentity = (key: string, version: string, protocol: string) =>
  `${key}/${version}/${protocol}`;

/** A configured account without its adapter code must stop startup instead of silently disabling payment. */
export function assertDeployedPaymentAdapters(
  connections: readonly PaymentAccountConnection[],
  factories: readonly PaymentConnectorFactory[],
): void {
  const deployed = new Set(
    factories.map(({ descriptor }) =>
      adapterIdentity(
        descriptor.adapterKey,
        descriptor.adapterVersion,
        descriptor.protocol,
      ),
    ),
  );
  if (
    connections.some(
      (connection) =>
        !deployed.has(
          adapterIdentity(
            connection.binding.providerCode,
            connection.adapterVersion,
            connection.protocol,
          ),
        ),
    )
  )
    throw new TypeError("Payment account has no deployed adapter");
}
