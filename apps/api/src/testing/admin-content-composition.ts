import { createAdminContentUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { AdminContentRouteOptions } from "../admin-content-route.js";

type AdminPersistence = Pick<
  PostgresPersistence,
  "adminContentTransactionManager" | "close"
>;
export type TestAdminContentCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
/** Internal integration composition. Production login/credential issuance is deliberately absent. */
export function createTestAdminContentComposition(
  options: TestAdminContentCompositionOptions,
  factories: Readonly<{
    createPersistence?: (config: PostgresConnectionConfig) => AdminPersistence;
  }> = {},
): Readonly<{
  adminContentRoute: AdminContentRouteOptions;
  adminContentRuntime: ApiLifecycleResource;
}> {
  if (
    options?.environment !== "TEST" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("test admin content configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test admin content origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test admin content origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  const useCases = createAdminContentUseCases({
    transactions: persistence.adminContentTransactionManager,
    tokenPepper: options.tokenPepper,
  });
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    adminContentRoute: { ...useCases, allowedOrigin: options.allowedOrigin },
    adminContentRuntime: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
