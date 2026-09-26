import type { PaymentAccountConnection } from "@fan-support/contracts";
import type { PaymentConnectorFactory } from "@fan-support/payment-gateway";

/**
 * Payment adapter code compiled into this release (V2 plan §3.1). The list only states which code
 * exists; deployed accounts activate through the versioned PostgreSQL publication. R1-3 adds
 * Stripe, then Airwallex and PayPal. TEST adapters never belong here.
 */
export const deployedPaymentConnectorFactories: readonly PaymentConnectorFactory[] =
  Object.freeze([]);

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
