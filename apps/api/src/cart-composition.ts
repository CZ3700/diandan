import { createCartRuntimeUseCases } from "@fan-support/application";
import {
  createKmsKeyManagementAdapter,
  type KmsKeyManagementAdapterConfig,
} from "@fan-support/key-management-kms";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { CartRouteDependencies } from "./cart-route.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";

type CartPersistence = Pick<
  PostgresPersistence,
  "cartRuntimeTransactionManager" | "close"
>;
type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => CartPersistence;
}>;
type Common = Readonly<{
  database: PostgresConnectionConfig;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
}>;
type Injected = Common &
  Readonly<{
    keyManagement: KeyManagementPort & SupportIntentKeyPort;
    activePepperVersion: string;
    pepperVersions: readonly string[];
    now?: () => Date;
    cartTtlMs?: number;
  }>;
export type CartRuntimeComposition = Readonly<{
  cartRoute: CartRouteDependencies;
  cartRuntime: ApiLifecycleResource;
}>;
function validOrigin(value: string, httpsOnly = false): void {
  const origin = new URL(value);
  if (
    origin.origin !== value ||
    !(httpsOnly ? ["https:"] : ["https:", "http:"]).includes(origin.protocol)
  )
    throw new TypeError("Invalid cart composition origin");
}
function compose(
  options: Injected,
  factories: Factories,
): CartRuntimeComposition {
  validOrigin(options.allowedOrigin);
  validOrigin(options.publicMediaBaseUrl, true);
  const credentials = createCartSessionCredentials(options);
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  let close: Promise<void> | undefined;
  const stop = () =>
    (close ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createCartRuntimeUseCases({
      transactions: persistence.cartRuntimeTransactionManager,
      keyManagement: options.keyManagement,
      ...(options.now ? { now: options.now } : {}),
      ...(options.cartTtlMs !== undefined
        ? { cartTtlMs: options.cartTtlMs }
        : {}),
    });
    return Object.freeze({
      cartRoute: {
        allowedOrigin: options.allowedOrigin,
        credentials,
        useCases,
      },
      cartRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Cart runtime construction failed");
  }
}
/** Production uses immutable KMS references and the AWS SDK's credential chain. */
export function createCartRuntimeComposition(
  options: Common &
    Readonly<{ keyManagementConfig: KmsKeyManagementAdapterConfig }>,
  factories: Factories = {},
): CartRuntimeComposition {
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
/** Explicit TEST composition keeps test cryptography out of production defaults. */
export function createTestCartRuntimeComposition(
  options: Injected & Readonly<{ environment: "TEST" }>,
  factories: Factories = {},
): CartRuntimeComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST cart environment");
  return compose(options, factories);
}
