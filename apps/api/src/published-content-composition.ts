import type { StorefrontCommerceRouteDependencies } from "./storefront-commerce-route.js";
import {
  createPublishedContentUseCases,
  createPublishedGiftCommerceUseCases,
  createStorefrontHomepageUseCases,
  createStorefrontCommerceUseCases,
} from "@fan-support/application";
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
import type { PublishedContentRouteDependencies } from "./published-content-route.js";
import type { PublishedGiftCommerceRouteDependencies } from "./published-gift-commerce-route.js";
import type { StorefrontHomepageRouteDependencies } from "./storefront-homepage-route.js";

type PublishedPersistence = Pick<
  PostgresPersistence,
  | "publishedContentTransactionManager"
  | "publishedGiftCommerceTransactionManager"
  | "storefrontHomepageTransactionManager"
  | "storefrontCommerceTransactionManager"
  | "close"
>;
type PersistenceFactory = (
  config: PostgresConnectionConfig,
  options: PostgresPersistenceOptions,
) => PublishedPersistence;

export type PublishedContentCompositionOptions = Readonly<{
  logger: StructuredLogger;
  factories?: Readonly<{ createPersistence?: PersistenceFactory }>;
}>;
export type PublishedContentComposition = Readonly<{
  publishedContentRoute: PublishedContentRouteDependencies;
  publishedGiftCommerceRoute: PublishedGiftCommerceRouteDependencies;
  storefrontHomepageRoute: StorefrontHomepageRouteDependencies;
  storefrontCommerceRoute: StorefrontCommerceRouteDependencies;
  publishedContentRuntime: ApiLifecycleResource;
}>;

export function createPublishedContentComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: PublishedContentCompositionOptions,
): PublishedContentComposition {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const storage = resolveObjectStorageRuntimeConfig({ environment });
  const createPersistence =
    options.factories?.createPersistence ?? createPostgresPersistence;
  const persistence = createPersistence(
    {
      connectionString: database.url,
      application_name: "fan-support-api-published-content",
    },
    {
      catalogPublicMediaBaseUrl: storage.publicMediaOrigin,
      onInfrastructureFailure: (failure) =>
        options.logger.error("published-content.persistence_failure", {
          errorCode: failure.code,
          outcome: "failure",
        }),
    },
  );
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    storefrontCommerceRoute: {
      useCases: createStorefrontCommerceUseCases({
        transactions: persistence.storefrontCommerceTransactionManager,
      }),
    },
    storefrontHomepageRoute: {
      useCases: createStorefrontHomepageUseCases({
        transactions: persistence.storefrontHomepageTransactionManager,
      }),
    },
    publishedGiftCommerceRoute: {
      useCases: createPublishedGiftCommerceUseCases({
        transactions: persistence.publishedGiftCommerceTransactionManager,
      }),
    },
    publishedContentRoute: {
      useCases: createPublishedContentUseCases({
        transactions: persistence.publishedContentTransactionManager,
      }),
    },
    publishedContentRuntime: Object.freeze({
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    }),
  });
}
