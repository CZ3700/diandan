import { createCatalogDirectoryUseCases } from "@fan-support/application";
import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
} from "@fan-support/config/server";
import type { StructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";

import type { ApiLifecycleResource } from "./bootstrap.js";
import type { CatalogDirectoryRouteOptions } from "./catalog-directory-route.js";

type DirectoryPersistence = Pick<
  PostgresPersistence,
  "contentReadTransactionManager" | "close"
>;
type PersistenceFactory = (
  config: PostgresConnectionConfig,
  options: PostgresPersistenceOptions,
) => DirectoryPersistence;

export type CatalogDirectoryCompositionOptions = Readonly<{
  logger: StructuredLogger;
  factories?: Readonly<{ createPersistence?: PersistenceFactory }>;
}>;
export type CatalogDirectoryComposition = Readonly<{
  catalogDirectoryRoute: CatalogDirectoryRouteOptions;
  catalogDirectoryRuntime: ApiLifecycleResource;
}>;

export function createCatalogDirectoryComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: CatalogDirectoryCompositionOptions,
): CatalogDirectoryComposition {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const storage = resolveObjectStorageRuntimeConfig({ environment });
  const createPersistence =
    options.factories?.createPersistence ?? createPostgresPersistence;
  const persistence = createPersistence(
    {
      connectionString: database.url,
      application_name: "fan-support-api-catalog",
    },
    {
      catalogPublicMediaBaseUrl: storage.publicMediaOrigin,
      onInfrastructureFailure: (failure) =>
        options.logger.error("catalog.persistence_failure", {
          errorCode: failure.code,
          outcome: "failure",
        }),
    },
  );
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    catalogDirectoryRoute: createCatalogDirectoryUseCases({
      transactions: persistence.contentReadTransactionManager,
    }),
    catalogDirectoryRuntime: Object.freeze({
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    }),
  });
}
