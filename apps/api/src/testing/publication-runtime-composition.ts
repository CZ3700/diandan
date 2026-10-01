import type { StorefrontCommerceRouteDependencies } from "../storefront-commerce-route.js";
import {
  createPublicationRuntimeUseCases,
  createPublishedContentUseCases,
  createStorefrontHomepageUseCases,
  createStorefrontCommerceUseCases,
  createStorefrontSeoUseCases,
  createPublicHomeLayoutUseCases,
  createPublicStorefrontThemeUseCases,
  createPublicStorefrontNavigationUseCases,
  createPublicInformationPageUseCases,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { PublishedContentRouteDependencies } from "../published-content-route.js";
import type { StorefrontHomepageRouteDependencies } from "../storefront-homepage-route.js";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { PublicationRuntimeRouteDependencies } from "../publication-runtime-route.js";
import type { PublicHomeLayoutRouteDependencies } from "../home-layout-route.js";
import type { PublicStorefrontThemeRouteDependencies } from "../storefront-theme-route.js";
import type { PublicStorefrontNavigationRouteDependencies } from "../storefront-navigation-route.js";
import type { PublicInformationPagesRouteDependencies } from "../information-pages-route.js";

type BasePersistence = Pick<
  PostgresPersistence,
  | "publicationRuntimeTransactionManager"
  | "publishedContentTransactionManager"
  | "storefrontHomepageTransactionManager"
  | "storefrontCommerceTransactionManager"
  | "storefrontSeoTransactionManager"
  | "homeLayoutTransactionManager"
  | "storefrontThemeTransactionManager"
  | "storefrontNavigationTransactionManager"
  | "informationPageTransactionManager"
  | "close"
>;
export type TestPublicationRuntimeCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
}>;
/** Local integration only; production login and session issuance stay outside this surface. */
export function createTestPublicationRuntimeComposition(
  options: TestPublicationRuntimeCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => BasePersistence;
  }> = {},
): Readonly<{
  publicationRuntimeRoute: PublicationRuntimeRouteDependencies;
  publicationRuntimeLifecycle: ApiLifecycleResource;
  publishedContentRoute: PublishedContentRouteDependencies;
  storefrontHomepageRoute: StorefrontHomepageRouteDependencies;
  storefrontCommerceRoute: StorefrontCommerceRouteDependencies;
  storefrontSeoRoute: StorefrontSeoRouteDependencies;
  publicHomeLayoutRoute: PublicHomeLayoutRouteDependencies;
  publicStorefrontThemeRoute: PublicStorefrontThemeRouteDependencies;
  publicStorefrontNavigationRoute: PublicStorefrontNavigationRouteDependencies;
  publicInformationPagesRoute: PublicInformationPagesRouteDependencies;
}> {
  if (
    options?.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("test publication runtime configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test publication runtime origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test publication runtime origin is invalid");
  let mediaOrigin: URL;
  try {
    mediaOrigin = new URL(options.publicMediaBaseUrl);
  } catch {
    throw new TypeError("test publication media origin is invalid");
  }
  if (
    mediaOrigin.protocol !== "https:" ||
    mediaOrigin.origin !== options.publicMediaBaseUrl
  )
    throw new TypeError("test publication media origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  const useCases = createPublicationRuntimeUseCases({
    transactions: persistence.publicationRuntimeTransactionManager,
    tokenPepper: options.tokenPepper,
  });
  const informationPages = createPublicInformationPageUseCases({
    transactions: persistence.informationPageTransactionManager,
  });
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    // Every deployed storefront page reads these; without them the homepage
    // renders its unavailable state (same wiring as the published composition).
    publicHomeLayoutRoute: {
      useCases: createPublicHomeLayoutUseCases({
        transactions: persistence.homeLayoutTransactionManager,
      }),
    },
    publicStorefrontThemeRoute: {
      useCases: createPublicStorefrontThemeUseCases({
        transactions: persistence.storefrontThemeTransactionManager,
      }),
    },
    publicStorefrontNavigationRoute: {
      useCases: createPublicStorefrontNavigationUseCases({
        transactions: persistence.storefrontNavigationTransactionManager,
      }),
    },
    publicInformationPagesRoute: {
      useCases: {
        read: informationPages.execute,
        index: informationPages.index,
      },
    },
    storefrontSeoRoute: {
      useCases: createStorefrontSeoUseCases({
        transactions: persistence.storefrontSeoTransactionManager,
      }),
    },
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
    publishedContentRoute: {
      useCases: createPublishedContentUseCases({
        transactions: persistence.publishedContentTransactionManager,
      }),
    },
    publicationRuntimeRoute: {
      useCases,
      allowedOrigin: options.allowedOrigin,
    },
    publicationRuntimeLifecycle: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
import type { StorefrontSeoRouteDependencies } from "../storefront-seo-route.js";
