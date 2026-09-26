import type { PaymentConnectorFactory } from "@fan-support/payment-gateway";

import type { ApiLifecycleResource } from "./bootstrap.js";
import { createPaymentConfigurationLifecycle } from "./payment-configuration-lifecycle.js";
import {
  createPaymentConfigurationRuntime,
  type PaymentConfigurationRuntime,
} from "./payment-configuration-runtime.js";
import type { PaymentDeploymentConfig } from "./payment-deployment-config.js";
import {
  createPaymentRuntimeComposition,
  type PaymentRuntimeComposition,
} from "./payment-runtime-composition.js";
import type { ApiProductionResources } from "./production-resources.js";

export type ProductionPaymentComposition = Readonly<{
  /** Deployed accounts plus the directory and health policies published in PostgreSQL (P5-05). */
  projection: PaymentConfigurationRuntime;
  paymentConfigurationRuntime: ApiLifecycleResource;
  /** Checkout payment routes; absent until the runtime configuration is deployed. */
  payment: PaymentRuntimeComposition | undefined;
}>;

/** Static adapter code plus published activation: code never loads at runtime, only rules change. */
export function createProductionPaymentComposition(
  options: Readonly<{
    config: PaymentDeploymentConfig;
    factories: readonly PaymentConnectorFactory[];
    resources: ApiProductionResources;
    publicMediaBaseUrl: string;
  }>,
): ProductionPaymentComposition {
  const configurationPersistence =
    options.resources.paymentConfigurationPersistence();
  const transactions =
    configurationPersistence.adminPaymentConfigurationTransactionManager;
  try {
    const projection = createPaymentConfigurationRuntime({
      connections: options.config.connections,
      factories: options.factories,
      initialPolicies: options.config.healthPolicies,
      readPublished: () =>
        transactions.runInAdminPaymentConfigurationTransaction((repository) =>
          repository.readPublished(),
        ),
    });
    const paymentConfigurationRuntime = createPaymentConfigurationLifecycle({
      refresh: projection.refresh,
      close: () => configurationPersistence.close(),
    });
    const runtime = options.config.runtime;
    const keys = options.resources.keys;
    if (runtime !== undefined && keys === undefined)
      throw new TypeError("Payment requires key management");
    const payment =
      runtime === undefined || keys === undefined
        ? undefined
        : createPaymentRuntimeComposition({
            openPersistence: options.resources.persistence,
            publicMediaBaseUrl: options.publicMediaBaseUrl,
            configuration: runtime,
            providers: [],
            providerDirectory: projection.providerDirectory,
            healthPolicies: options.config.healthPolicies,
            readHealthPolicies: projection.readPolicies,
            ...keys,
          });
    return Object.freeze({ projection, paymentConfigurationRuntime, payment });
  } catch (error) {
    void configurationPersistence.close().catch(() => undefined);
    throw error;
  }
}
