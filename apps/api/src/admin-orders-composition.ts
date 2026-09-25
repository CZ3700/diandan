import { createAdminOrdersUseCases } from "@fan-support/application";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { AdminOrdersRouteDependencies } from "./admin-orders-route.js";
import type { ApiLifecycleResource } from "./bootstrap.js";
type Persistence = Pick<
  PostgresPersistence,
  "adminOrdersTransactionManager" | "close"
>;
export type LocalAdminOrdersCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
  keys: KeyManagementPort;
}>;
function httpsOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}
/** Shares the platform's OIDC session pepper; only its PostgreSQL pool is owned. */
export function createLocalAdminOrdersComposition(
  options: LocalAdminOrdersCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => Persistence;
  }> = {},
): Readonly<{
  adminOrdersRoute: AdminOrdersRouteDependencies;
  adminOrdersRuntime: ApiLifecycleResource;
}> {
  if (
    options.environment !== "LOCAL_OIDC" ||
    !httpsOrigin(options.allowedOrigin) ||
    !httpsOrigin(options.publicMediaBaseUrl) ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    typeof options.keys?.encryptEnvelope !== "function" ||
    typeof options.keys?.decryptEnvelope !== "function"
  )
    throw new TypeError("Invalid local admin orders configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminOrdersRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminOrdersUseCases({
          transactions: persistence.adminOrdersTransactionManager,
          keys: options.keys,
          tokenPepper: options.tokenPepper,
        }),
      },
      adminOrdersRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Local admin orders construction failed");
  }
}
