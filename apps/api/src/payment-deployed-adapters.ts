import type {
  PaymentAccountConnection,
  PaymentGatewayWebhookConfig,
} from "@fan-support/contracts";
import {
  AIRWALLEX_ADAPTER_KEY,
  AIRWALLEX_MAX_ACTION_TTL_MS,
  AIRWALLEX_SIGNATURE_HEADER,
  AIRWALLEX_TIMESTAMP_HEADER,
  createAirwallexAdapter,
} from "@fan-support/payment-airwallex";
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
  /** The longest a stored payment action may live for this account, when its provider limits it. */
  maximumActionTtlMs?(connection: PaymentAccountConnection): number | undefined;
}>;

/**
 * V2 plan §3.1: static code, configuration activation. Stripe and Airwallex ship in R1-3;
 * PayPal follows. TEST adapters never belong here.
 */
export function createDeployedPaymentAdapters(
  options: Readonly<{ credentials: PaymentCredentialResolver }>,
): DeployedPaymentAdapters {
  const stripe = createStripeAdapter({ credentials: options.credentials });
  const airwallex = createAirwallexAdapter({
    credentials: options.credentials,
  });
  return Object.freeze({
    connectorFactories: Object.freeze([stripe.connector, airwallex.connector]),
    webhookVerifierFor(configuration, connection) {
      switch (connection.binding.providerCode) {
        case STRIPE_ADAPTER_KEY:
          return Object.freeze({
            verifier: stripe.createWebhookVerifier(configuration, connection),
            headerNames: Object.freeze([STRIPE_SIGNATURE_HEADER]),
          });
        case AIRWALLEX_ADAPTER_KEY:
          return Object.freeze({
            verifier: airwallex.createWebhookVerifier(
              configuration,
              connection,
            ),
            headerNames: Object.freeze([
              AIRWALLEX_SIGNATURE_HEADER,
              AIRWALLEX_TIMESTAMP_HEADER,
            ]),
          });
        default:
          return undefined;
      }
    },
    maximumActionTtlMs(connection) {
      return connection.binding.providerCode === AIRWALLEX_ADAPTER_KEY
        ? AIRWALLEX_MAX_ACTION_TTL_MS
        : undefined;
    },
  });
}

/** A stored action that outlives the provider's client token would open a dead payment page. */
export function assertPaymentActionLifetime(
  actionTtlMs: number | undefined,
  connections: readonly PaymentAccountConnection[],
  adapters: DeployedPaymentAdapters,
): void {
  if (actionTtlMs === undefined) return;
  for (const connection of connections) {
    const limit = adapters.maximumActionTtlMs?.(connection);
    if (limit !== undefined && actionTtlMs > limit)
      throw new TypeError(
        "Payment action lifetime exceeds a deployed provider token",
      );
  }
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
