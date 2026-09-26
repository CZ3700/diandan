import { createCheckoutPreflightUseCases } from "@fan-support/application";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
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
export type CheckoutPreflightCompositionOptions = Readonly<{
  /** Called once after validation; stopping the runtime closes what it returned. */
  openPersistence(): Persistence;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
  keyManagement: KeyManagementPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
  preflightTtlMs?: number;
}>;
export type CheckoutPreflightComposition = Readonly<{
  checkoutPreflightRoute: CheckoutPreflightRouteDependencies;
  checkoutPreflightRuntime: ApiLifecycleResource;
}>;

/** Checkout shares the deployment's cart key port and borrows an injected pool. */
export function createCheckoutPreflightComposition(
  options: CheckoutPreflightCompositionOptions,
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
  const persistence = options.openPersistence();
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

export function createTestCheckoutPreflightComposition(
  options: Omit<CheckoutPreflightCompositionOptions, "openPersistence"> &
    Readonly<{ environment: "TEST"; database: PostgresConnectionConfig }>,
  factories: Factories = {},
): CheckoutPreflightComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST checkout environment");
  return createCheckoutPreflightComposition({
    ...options,
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
