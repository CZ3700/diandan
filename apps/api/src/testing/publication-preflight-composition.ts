import { createPublicationPreflightUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { PublicationPreflightRouteDependencies } from "../publication-preflight-route.js";

type BasePersistence = Pick<
  PostgresPersistence,
  "publicationPreflightTransactionManager" | "close"
>;
export type TestPublicationPreflightCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
/** Local integration only; production login and session issuance stay outside this surface. */
export function createTestPublicationPreflightComposition(
  options: TestPublicationPreflightCompositionOptions,
  factories: Readonly<{
    createPersistence?: (config: PostgresConnectionConfig) => BasePersistence;
  }> = {},
): Readonly<{
  publicationPreflightRoute: PublicationPreflightRouteDependencies;
  publicationPreflightRuntime: ApiLifecycleResource;
}> {
  if (
    options?.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("test publication preflight configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test publication preflight origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test publication preflight origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  const useCases = createPublicationPreflightUseCases({
    transactions: persistence.publicationPreflightTransactionManager,
    tokenPepper: options.tokenPepper,
  });
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    publicationPreflightRoute: {
      useCases,
      allowedOrigin: options.allowedOrigin,
    },
    publicationPreflightRuntime: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
