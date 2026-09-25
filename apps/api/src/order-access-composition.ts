import { createOrderAccessUseCases } from "@fan-support/application";
import {
  orderAccessConfigurationSchema,
  paymentRuntimeOriginSchema,
  type OrderAccessConfiguration,
} from "@fan-support/contracts";
import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import {
  createKmsKeyManagementAdapter,
  type KmsKeyManagementAdapterConfig,
} from "@fan-support/key-management-kms";
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
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";
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
type Common = Readonly<{
  database: PostgresConnectionConfig;
  publicMediaBaseUrl: string;
  configuration: OrderAccessConfiguration;
}>;
type Injected = Common &
  Readonly<{
    keyManagement: KeyManagementPort;
    activePepperVersion: string;
    pepperVersions: readonly string[];
  }>;
export type OrderAccessComposition = Readonly<{
  orderAccessRoute: OrderAccessRouteDependencies;
  orderAccessRuntime: ApiLifecycleResource;
}>;

function compose(
  options: Injected,
  factories: Factories,
): OrderAccessComposition {
  const configuration = orderAccessConfigurationSchema.parse(
    options.configuration,
  );
  paymentRuntimeOriginSchema.parse(options.publicMediaBaseUrl);
  const credentials = createOrderAccessCredentials(options);
  const cartCredentials = createCartSessionCredentials(options);
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
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
  options: Injected & { environment: "TEST" },
  factories: Factories = {},
): OrderAccessComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST order access environment");
  return compose(options, factories);
}
export function createOrderAccessComposition(
  options: Common & { keyManagementConfig: KmsKeyManagementAdapterConfig },
  factories: Factories = {},
): OrderAccessComposition {
  return compose(
    {
      ...options,
      keyManagement: createKmsKeyManagementAdapter(options.keyManagementConfig),
      activePepperVersion:
        options.keyManagementConfig.activeBlindIndexKeyVersion,
      pepperVersions: Object.keys(
        options.keyManagementConfig.blindIndexKeyIdsByVersion,
      ),
    },
    factories,
  );
}

/** Only an explicit, complete server configuration activates access. No credentials or defaults are generated. */
export function createOptionalOrderAccessComposition(
  environment: Readonly<Record<string, string | undefined>>,
): OrderAccessComposition | undefined {
  const text = environment["FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON"];
  if (text === undefined) return undefined;
  let configuration: OrderAccessConfiguration;
  try {
    if (text.length > 16_384)
      throw new Error("Invalid order access configuration");
    configuration = orderAccessConfigurationSchema.parse(JSON.parse(text));
  } catch {
    throw new TypeError("Invalid order access runtime configuration");
  }
  const sources = { environment };
  if (
    resolveServerRuntimeConfig(sources).siteOrigin !==
    configuration.publicStorefrontOrigin
  )
    throw new TypeError("Order access origin does not match deployment");
  return createOrderAccessComposition({
    database: {
      connectionString: resolveDatabaseRuntimeConfig(sources).url,
      application_name: "fan-support-api-order-access",
    },
    publicMediaBaseUrl:
      resolveObjectStorageRuntimeConfig(sources).publicMediaOrigin,
    keyManagementConfig: resolveCartRuntimeConfig(environment),
    configuration,
  });
}
