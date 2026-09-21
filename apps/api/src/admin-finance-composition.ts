import { createAdminFinanceUseCases } from "@fan-support/application";
import type {
  PaymentRuntimeProviderDirectory,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { AdminFinanceRouteDependencies } from "./admin-finance-route.js";
import { createPaymentRecoveryLifecycle } from "./payment-runtime-lifecycle.js";
type Persistence = Pick<
  PostgresPersistence,
  "adminFinanceTransactionManager" | "close"
>;
export type LocalAdminFinanceCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  providers: readonly PaymentRuntimeProviderRegistration[];
  providerDirectory?: PaymentRuntimeProviderDirectory;
  leaseMs?: number;
  retryAfterMs?: number;
  batchSize?: number;
}>;
/** Financial timers supply liveness only; leases, command acceptance and provider identities remain durable. */
export function createLocalAdminFinanceComposition(
  options: LocalAdminFinanceCompositionOptions,
  factories: Readonly<{
    createPersistence?: (database: PostgresConnectionConfig) => Persistence;
  }> = {},
): Readonly<{
  adminFinanceRoute: AdminFinanceRouteDependencies;
  adminFinanceRuntime: ApiLifecycleResource;
}> {
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("Invalid finance origin");
  }
  if (
    options.environment !== "LOCAL_OIDC" ||
    origin.protocol !== "https:" ||
    origin.origin !== options.allowedOrigin ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("Invalid finance configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createAdminFinanceUseCases({
      transactions: persistence.adminFinanceTransactionManager,
      tokenPepper: options.tokenPepper,
      providers: options.providers,
      ...(options.providerDirectory
        ? { providerDirectory: options.providerDirectory }
        : {}),
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      ...(options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.retryAfterMs }),
    });
    const batchSize = options.batchSize ?? 10;
    return Object.freeze({
      adminFinanceRoute: { allowedOrigin: options.allowedOrigin, useCases },
      adminFinanceRuntime: createPaymentRecoveryLifecycle({
        recoverNext: useCases.recoverNext,
        probeNext: () => useCases.runPending(batchSize),
        delayMs: options.retryAfterMs ?? 10000,
        batchSize,
        close,
      }),
    });
  } catch {
    void close().catch(() => undefined);
    throw new TypeError("Finance construction failed");
  }
}
