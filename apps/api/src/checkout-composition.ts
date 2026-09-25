import { createCheckoutPreflightUseCases } from "@fan-support/application";
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
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";
import type { CheckoutPreflightRouteDependencies } from "./checkout-preflight-route.js";

type Persistence = Pick<
  PostgresPersistence,
  "checkoutPreflightTransactionManager" | "close"
>;
type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => Persistence;
}>;
type Common = Readonly<{
  database: PostgresConnectionConfig;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
}>;
type Injected = Common &
  Readonly<{
    keyManagement: KeyManagementPort;
    activePepperVersion: string;
    pepperVersions: readonly string[];
    preflightTtlMs?: number;
  }>;
export type CheckoutPreflightComposition = Readonly<{
  checkoutPreflightRoute: CheckoutPreflightRouteDependencies;
  checkoutPreflightRuntime: ApiLifecycleResource;
}>;

function compose(
  options: Injected,
  factories: Factories,
): CheckoutPreflightComposition {
  const origin = new URL(options.allowedOrigin);
  const media = new URL(options.publicMediaBaseUrl);
  if (
    origin.origin !== options.allowedOrigin ||
    !["https:", "http:"].includes(origin.protocol) ||
    media.origin !== options.publicMediaBaseUrl ||
    media.protocol !== "https:"
  )
    throw new TypeError("Invalid checkout composition origin");
  const credentials = createCartSessionCredentials(options);
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  let closed: Promise<void> | undefined;
  const stop = () =>
    (closed ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createCheckoutPreflightUseCases({
      transactions: persistence.checkoutPreflightTransactionManager,
      keyManagement: options.keyManagement,
      ...(options.preflightTtlMs !== undefined
        ? { preflightTtlMs: options.preflightTtlMs }
        : {}),
    });
    return Object.freeze({
      checkoutPreflightRoute: {
        allowedOrigin: options.allowedOrigin,
        credentials,
        useCases,
      },
      checkoutPreflightRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Checkout runtime construction failed");
  }
}

export function createCheckoutPreflightComposition(
  options: Common &
    Readonly<{ keyManagementConfig: KmsKeyManagementAdapterConfig }>,
  factories: Factories = {},
): CheckoutPreflightComposition {
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

export function createTestCheckoutPreflightComposition(
  options: Injected & Readonly<{ environment: "TEST" }>,
  factories: Factories = {},
): CheckoutPreflightComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST checkout environment");
  return compose(options, factories);
}

/** Checkout uses the same deployment-owned cart KMS references, never generated production defaults. */
export function createOptionalCheckoutPreflightComposition(
  environment: Readonly<Record<string, string | undefined>>,
): CheckoutPreflightComposition | undefined {
  const keys = [
    "FAN_SUPPORT_CART_KMS_REGION",
    "FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION",
    "FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON",
    "FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION",
    "FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON",
  ];
  if (keys.every((key) => environment[key] === undefined)) return undefined;
  const keyManagementConfig = resolveCartRuntimeConfig(environment);
  const sources = { environment };
  return createCheckoutPreflightComposition({
    database: {
      connectionString: resolveDatabaseRuntimeConfig(sources).url,
      application_name: "fan-support-api-checkout",
    },
    allowedOrigin: resolveServerRuntimeConfig(sources).siteOrigin,
    publicMediaBaseUrl:
      resolveObjectStorageRuntimeConfig(sources).publicMediaOrigin,
    keyManagementConfig,
  });
}
