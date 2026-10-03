import { createAdminExceptionsUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { AdminExceptionsRouteDependencies } from "../admin-exceptions-route.js";
export type LocalAdminExceptionsCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
type Persistence = Pick<
  PostgresPersistence,
  "adminExceptionsTransactionManager" | "close"
>;
export function createLocalAdminExceptionsComposition(
  options: LocalAdminExceptionsCompositionOptions,
  factories: Readonly<{
    createPersistence?: (database: PostgresConnectionConfig) => Persistence;
  }> = {},
): Readonly<{
  adminExceptionsRoute: AdminExceptionsRouteDependencies;
  adminExceptionsRuntime: ApiLifecycleResource;
}> {
  const origin = new URL(options.allowedOrigin);
  if (
    options.environment !== "LOCAL_OIDC" ||
    origin.protocol !== "https:" ||
    origin.origin !== options.allowedOrigin ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("Invalid exception configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createAdminExceptionsUseCases({
      transactions: persistence.adminExceptionsTransactionManager,
      tokenPepper: options.tokenPepper,
    });
    return Object.freeze({
      adminExceptionsRoute: { allowedOrigin: options.allowedOrigin, useCases },
      adminExceptionsRuntime: { start: async () => undefined, stop: close },
    });
  } catch {
    void close().catch(() => undefined);
    throw new TypeError("Exception construction failed");
  }
}
