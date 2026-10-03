import type { AdminSessionRouteDependencies } from "../admin-session-route.js";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type {
  PostgresConnectionConfig,
  PostgresPersistence,
} from "@fan-support/persistence-postgres";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { createAdminSessionUseCases } from "@fan-support/application";
type SessionPersistence = Pick<
  PostgresPersistence,
  "adminSessionTransactionManager" | "close"
>;
export type TestAdminSessionCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
export function createTestAdminSessionComposition(
  options: TestAdminSessionCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
    ) => SessionPersistence;
  }> = {},
): Readonly<{
  adminSessionRoute: AdminSessionRouteDependencies;
  adminSessionRuntime: ApiLifecycleResource;
}> {
  if (
    options.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("Invalid TEST session configuration");
  const origin = new URL(options.allowedOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.allowedOrigin
  )
    throw new TypeError("Invalid TEST session origin");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  let close: Promise<void> | undefined;
  const stop = () =>
    (close ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminSessionRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminSessionUseCases({
          tokenPepper: options.tokenPepper,
          transactions: persistence.adminSessionTransactionManager,
        }),
      },
      adminSessionRuntime: {
        start: async () => undefined,
        stop,
      },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("TEST session construction failed");
  }
}
