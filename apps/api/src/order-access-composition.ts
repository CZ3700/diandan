import { createOrderAccessUseCases } from "@fan-support/application";
import {
  orderAccessConfigurationSchema,
  paymentRuntimeOriginSchema,
  type OrderAccessConfiguration,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { createOrderAccessCredentials } from "./order-access-credentials.js";
import type { OrderAccessRouteDependencies } from "./order-access-route.js";

type Persistence = Pick<
  PostgresPersistence,
  "orderAccessTransactionManager" | "close"
>;
type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => Persistence;
}>;
export type OrderAccessCompositionOptions = Readonly<{
  /** Called once after validation; stopping the runtime closes what it returned. */
  openPersistence(): Persistence;
  publicMediaBaseUrl: string;
  configuration: OrderAccessConfiguration;
  keyManagement: KeyManagementPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
}>;
export type OrderAccessComposition = Readonly<{
  orderAccessRoute: OrderAccessRouteDependencies;
  orderAccessRuntime: ApiLifecycleResource;
}>;

/** Order access shares the deployment's key port and borrows an injected pool. */
export function createOrderAccessComposition(
  options: OrderAccessCompositionOptions,
): OrderAccessComposition {
  const configuration = orderAccessConfigurationSchema.parse(
    options.configuration,
  );
  paymentRuntimeOriginSchema.parse(options.publicMediaBaseUrl);
  const credentials = createOrderAccessCredentials(options);
  const cartCredentials = createCartSessionCredentials(options);
  const persistence = options.openPersistence();
  let closed: Promise<void> | undefined;
  const stop = () =>
    (closed ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createOrderAccessUseCases({
      transactions: persistence.orderAccessTransactionManager,
    });
    return Object.freeze({
      orderAccessRoute: {
        configuration,
        credentials,
        cartCredentials,
        useCases,
      },
      orderAccessRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Order access runtime construction failed");
  }
}
export function createTestOrderAccessComposition(
  options: Omit<OrderAccessCompositionOptions, "openPersistence"> & {
    environment: "TEST";
    database: PostgresConnectionConfig;
  },
  factories: Factories = {},
): OrderAccessComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST order access environment");
  return createOrderAccessComposition({
    ...options,
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
