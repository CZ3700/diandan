import { createAdminPaymentConfigurationUseCases } from "@fan-support/application";
import type {
  PaymentAccountConnection,
  PaymentHealthPolicy,
} from "@fan-support/contracts";
import type { PaymentConnectorFactory } from "@fan-support/payment-gateway";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { AdminPaymentConfigurationRouteDependencies } from "../admin-payment-configuration-route.js";
import { createPaymentConfigurationRuntime } from "../payment-configuration-runtime.js";
import { createPaymentConfigurationLifecycle } from "../payment-configuration-lifecycle.js";
import type { ApiLifecycleResource } from "../bootstrap.js";
type Persistence = Pick<
  PostgresPersistence,
  "adminPaymentConfigurationTransactionManager" | "close"
>;
export type LocalAdminPaymentConfigurationCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  connections: readonly PaymentAccountConnection[];
  factories: readonly PaymentConnectorFactory[];
  initialProviderAccountIds?: readonly string[];
  healthPolicies: readonly PaymentHealthPolicy[];
  refreshDelayMs?: number;
}>;
/** Static deployment owns credentials and adapter code; authenticated PostgreSQL commands own published operating rules. */
export function createLocalAdminPaymentConfigurationComposition(
  options: LocalAdminPaymentConfigurationCompositionOptions,
  factories: Readonly<{
    createPersistence?: (database: PostgresConnectionConfig) => Persistence;
  }> = {},
) {
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("Invalid payment configuration origin");
  }
  if (
    options.environment !== "LOCAL_OIDC" ||
    origin.protocol !== "https:" ||
    origin.origin !== options.allowedOrigin ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("Invalid payment administration configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )({
    ...options.database,
    // This dedicated pool must not inherit unbounded deployment defaults.
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    const transactions =
      persistence.adminPaymentConfigurationTransactionManager;
    const projection = createPaymentConfigurationRuntime({
      connections: options.connections,
      factories: options.factories,
      ...(options.initialProviderAccountIds
        ? { initialProviderAccountIds: options.initialProviderAccountIds }
        : {}),
      initialPolicies: options.healthPolicies,
      readPublished: () =>
        transactions.runInAdminPaymentConfigurationTransaction((repository) =>
          repository.readPublished(),
        ),
    });
    const useCases = createAdminPaymentConfigurationUseCases({
      transactions,
      tokenPepper: options.tokenPepper,
      deployedAccounts: projection.deployedAccounts,
    });
    const adminPaymentConfigurationRuntime: ApiLifecycleResource =
      createPaymentConfigurationLifecycle({
        refresh: projection.refresh,
        close,
        ...(options.refreshDelayMs === undefined
          ? {}
          : { delayMs: options.refreshDelayMs }),
      });
    const adminPaymentConfigurationRoute: AdminPaymentConfigurationRouteDependencies =
      { allowedOrigin: options.allowedOrigin, useCases };
    return Object.freeze({
      adminPaymentConfigurationRoute,
      adminPaymentConfigurationRuntime,
      providerDirectory: projection.providerDirectory,
      readHealthPolicies: projection.readPolicies,
      get generation() {
        return projection.generation;
      },
    });
  } catch {
    void close().catch(() => undefined);
    throw new TypeError("Payment configuration construction failed");
  }
}
