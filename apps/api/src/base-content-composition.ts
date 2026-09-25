import { createBaseContentUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { BaseContentRouteDependencies } from "./base-content-route.js";

type BasePersistence = Pick<
  PostgresPersistence,
  "baseContentTransactionManager" | "close"
>;
export type TestBaseContentCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
/** Local integration only; production login and session issuance stay outside this surface. */
export function createTestBaseContentComposition(
  options: TestBaseContentCompositionOptions,
  factories: Readonly<{
    createPersistence?: (config: PostgresConnectionConfig) => BasePersistence;
  }> = {},
): Readonly<{
  baseContentRoute: BaseContentRouteDependencies;
  baseContentRuntime: ApiLifecycleResource;
}> {
  if (
    options?.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("test base content configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test base content origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test base content origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  const useCases = createBaseContentUseCases({
    transactions: persistence.baseContentTransactionManager,
    tokenPepper: options.tokenPepper,
  });
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseContentRoute: { useCases, allowedOrigin: options.allowedOrigin },
    baseContentRuntime: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
