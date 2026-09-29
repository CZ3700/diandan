import {
  createAdminAccessUseCases,
  createAdminCatalogUseCases,
  createAdminContentUseCases,
  createAdminExceptionsUseCases,
  createAdminFinanceUseCases,
  createAdminOrdersUseCases,
  createAdminPaymentConfigurationUseCases,
  createAdminPreviewMediaUseCases,
  createAdminSessionUseCases,
  createBaseContentUseCases,
  createContentAuthoringUseCases,
  createGiftCommerceUseCases,
  createManagementCenterUseCases,
  createHomeLayoutUseCases,
  createCatalogDisplayOrderUseCases,
  createStorefrontThemeUseCases,
  createStorefrontNavigationUseCases,
  createInformationPageUseCases,
  createPublicationPreflightUseCases,
  createPublicationRuntimeUseCases,
  createResourceManagementUseCases,
  createTranslationTransferUseCases,
  createTranslationWorkspaceUseCases,
} from "@fan-support/application";
import {
  createOidcIdentityProvider,
  type OidcIdentityProviderDependencies,
} from "@fan-support/identity-oidc";
import type { PostgresPersistence } from "@fan-support/persistence-postgres";

import type { AdminAccessRouteDependencies } from "./admin-access-route.js";
import type { AdminContentRouteOptions } from "./admin-content-route.js";
import type { AdminExceptionsRouteDependencies } from "./admin-exceptions-route.js";
import type { AdminFinanceRouteDependencies } from "./admin-finance-route.js";
import type { AdminOrdersRouteDependencies } from "./admin-orders-route.js";
import type { AdminPaymentConfigurationRouteDependencies } from "./admin-payment-configuration-route.js";
import type { AdminApiRuntimeConfig } from "./admin-runtime-config.js";
import type { AdminSessionRouteDependencies } from "./admin-session-route.js";
import type {
  AdminCatalogRouteDependencies,
  AdminPreviewMediaRouteDependencies,
  TranslationTransferRouteDependencies,
  TranslationWorkspaceRouteDependencies,
} from "./admin-workspace-route.js";
import type { BaseContentRouteDependencies } from "./base-content-route.js";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { ContentAuthoringRouteDependencies } from "./admin-content-authoring-route.js";
import type { GiftCommerceRouteDependencies } from "./gift-commerce-route.js";
import type { ManagementCenterRouteDependencies } from "./management-center-route.js";
import type { HomeLayoutRouteDependencies } from "./home-layout-route.js";
import type { CatalogDisplayOrderRouteDependencies } from "./catalog-display-order-route.js";
import type { StorefrontThemeRouteDependencies } from "./storefront-theme-route.js";
import type { StorefrontNavigationRouteDependencies } from "./storefront-navigation-route.js";
import type { InformationPagesRouteDependencies } from "./information-pages-route.js";
import { createPaymentRecoveryLifecycle } from "./payment-runtime-lifecycle.js";
import type { PaymentConfigurationRuntime } from "./payment-configuration-runtime.js";
import type { ApiProductionResources } from "./production-resources.js";
import type { PublicationPreflightRouteDependencies } from "./publication-preflight-route.js";
import type { PublicationRuntimeRouteDependencies } from "./publication-runtime-route.js";
import type { ResourceManagementRouteDependencies } from "./resource-management-route.js";

export type ProductionAdminCompositionOptions = Readonly<{
  config: AdminApiRuntimeConfig;
  resources: Pick<
    ApiProductionResources,
    "persistence" | "paymentConfigurationPersistence" | "keys" | "media"
  >;
  payment: Pick<
    PaymentConfigurationRuntime,
    "deployedAccounts" | "providerDirectory"
  >;
  identityTransport?: OidcIdentityProviderDependencies;
}>;
export type ProductionAdminComposition = Readonly<{
  adminAccessRoute: AdminAccessRouteDependencies;
  adminSessionRoute: AdminSessionRouteDependencies;
  adminAccessRuntime: ApiLifecycleResource;
  adminCatalogRoute: AdminCatalogRouteDependencies;
  translationWorkspaceRoute: TranslationWorkspaceRouteDependencies;
  translationTransferRoute: TranslationTransferRouteDependencies;
  adminPreviewMediaRoute: AdminPreviewMediaRouteDependencies;
  contentAuthoringRoute: ContentAuthoringRouteDependencies;
  baseContentRoute: BaseContentRouteDependencies;
  adminContentRoute: AdminContentRouteOptions;
  resourceManagementRoute: ResourceManagementRouteDependencies;
  managementCenterRoute: ManagementCenterRouteDependencies;
  homeLayoutRoute: HomeLayoutRouteDependencies;
  catalogDisplayOrderRoute: CatalogDisplayOrderRouteDependencies;
  storefrontThemeRoute: StorefrontThemeRouteDependencies;
  storefrontNavigationRoute: StorefrontNavigationRouteDependencies;
  informationPagesRoute: InformationPagesRouteDependencies;
  publicationPreflightRoute: PublicationPreflightRouteDependencies;
  publicationRuntimeRoute: PublicationRuntimeRouteDependencies;
  giftCommerceRoute: GiftCommerceRouteDependencies;
  adminOrdersRoute: AdminOrdersRouteDependencies;
  adminFinanceRoute: AdminFinanceRouteDependencies;
  adminFinanceRuntime: ApiLifecycleResource;
  adminExceptionsRoute: AdminExceptionsRouteDependencies;
  adminPaymentConfigurationRoute: AdminPaymentConfigurationRouteDependencies;
  adminPaymentConfigurationRuntime: ApiLifecycleResource;
}>;

const FINANCE_BATCH_SIZE = 10;
const FINANCE_RETRY_AFTER_MS = 10_000;

function releaseOnStop(
  persistence: Pick<PostgresPersistence, "close">,
): ApiLifecycleResource {
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    start: async () => undefined,
    stop: () =>
      (stopping ??= Promise.resolve().then(() => persistence.close())),
  });
}

/** Wires the whole administration surface. Identity, roles and MFA stay behind the OIDC and session use cases. */
export function createProductionAdminComposition(
  options: ProductionAdminCompositionOptions,
): ProductionAdminComposition {
  const { config, resources, payment } = options;
  const keys = resources.keys;
  const media = resources.media;
  if (keys === undefined || media === undefined)
    throw new TypeError("Administration requires key management and media");
  const { allowedOrigin, tokenPepper } = config;
  // Loops own separate holds so a pool never closes under in-flight recovery work.
  const persistence = resources.persistence();
  const financePersistence = resources.persistence();
  const configurationPersistence = resources.paymentConfigurationPersistence();
  try {
    const identityProvider = createOidcIdentityProvider(
      config.provider,
      options.identityTransport,
    );
    const resourceManagement = createResourceManagementUseCases({
      transactions: persistence.resourceManagementTransactionManager,
      tokenPepper,
      storage: media.storage,
      inspector: media.inspector,
    });
    const finance = createAdminFinanceUseCases({
      transactions: financePersistence.adminFinanceTransactionManager,
      tokenPepper,
      providers: [],
      providerDirectory: payment.providerDirectory,
      retryAfterMs: FINANCE_RETRY_AFTER_MS,
    });
    return Object.freeze({
      adminAccessRoute: {
        allowedOrigin,
        accessKey: config.accessKey,
        useCases: createAdminAccessUseCases({
          settings: config.settings,
          identityProvider,
          tokenPepper,
          subjectPepper: config.subjectPepper,
          transactions: persistence.adminAccessTransactionManager,
        }),
      },
      adminSessionRoute: {
        allowedOrigin,
        useCases: createAdminSessionUseCases({
          tokenPepper,
          transactions: persistence.adminSessionTransactionManager,
        }),
      },
      adminAccessRuntime: releaseOnStop(persistence),
      adminCatalogRoute: {
        allowedOrigin,
        useCases: createAdminCatalogUseCases({
          transactions: persistence.adminCatalogTransactionManager,
          tokenPepper,
        }),
      },
      translationWorkspaceRoute: {
        allowedOrigin,
        useCases: createTranslationWorkspaceUseCases({
          transactions: persistence.translationWorkspaceTransactionManager,
          tokenPepper,
        }),
      },
      translationTransferRoute: {
        allowedOrigin,
        useCases: createTranslationTransferUseCases({
          transactions: persistence.translationTransferTransactionManager,
          tokenPepper,
        }),
      },
      adminPreviewMediaRoute: {
        allowedOrigin,
        useCases: createAdminPreviewMediaUseCases({
          transactions: persistence.adminPreviewMediaTransactionManager,
          tokenPepper,
          storage: media.storage,
        }),
      },
      contentAuthoringRoute: {
        allowedOrigin,
        useCases: createContentAuthoringUseCases({
          transactions: persistence.contentAuthoringTransactionManager,
          tokenPepper,
        }),
      },
      baseContentRoute: {
        allowedOrigin,
        useCases: createBaseContentUseCases({
          transactions: persistence.baseContentTransactionManager,
          tokenPepper,
        }),
      },
      adminContentRoute: {
        ...createAdminContentUseCases({
          transactions: persistence.adminContentTransactionManager,
          tokenPepper,
        }),
        allowedOrigin,
      },
      resourceManagementRoute: { allowedOrigin, useCases: resourceManagement },
      managementCenterRoute: {
        allowedOrigin,
        useCases: createManagementCenterUseCases({
          transactions: persistence.managementCenterTransactionManager,
          resourceManagement,
          storage: media.storage,
          tokenPepper,
        }),
      },
      homeLayoutRoute: {
        allowedOrigin,
        useCases: createHomeLayoutUseCases({
          transactions: persistence.homeLayoutTransactionManager,
          tokenPepper,
        }),
      },
      catalogDisplayOrderRoute: {
        allowedOrigin,
        useCases: createCatalogDisplayOrderUseCases({
          transactions: persistence.catalogDisplayOrderTransactionManager,
          tokenPepper,
        }),
      },
      storefrontThemeRoute: {
        allowedOrigin,
        useCases: createStorefrontThemeUseCases({
          transactions: persistence.storefrontThemeTransactionManager,
          tokenPepper,
        }),
      },
      informationPagesRoute: {
        allowedOrigin,
        useCases: createInformationPageUseCases({
          transactions: persistence.informationPageTransactionManager,
          tokenPepper,
        }),
      },
      storefrontNavigationRoute: {
        allowedOrigin,
        useCases: createStorefrontNavigationUseCases({
          transactions: persistence.storefrontNavigationTransactionManager,
          tokenPepper,
        }),
      },
      publicationPreflightRoute: {
        allowedOrigin,
        useCases: createPublicationPreflightUseCases({
          transactions: persistence.publicationPreflightTransactionManager,
          tokenPepper,
        }),
      },
      publicationRuntimeRoute: {
        allowedOrigin,
        useCases: createPublicationRuntimeUseCases({
          transactions: persistence.publicationRuntimeTransactionManager,
          tokenPepper,
        }),
      },
      giftCommerceRoute: {
        allowedOrigin,
        useCases: createGiftCommerceUseCases({
          tokenPepper,
          transactions: persistence.giftCommerceTransactionManager,
        }),
      },
      adminOrdersRoute: {
        allowedOrigin,
        useCases: createAdminOrdersUseCases({
          transactions: persistence.adminOrdersTransactionManager,
          keys: keys.keyManagement,
          tokenPepper,
          proofs: { storage: media.storage, processor: media.proofProcessor },
        }),
      },
      adminFinanceRoute: { allowedOrigin, useCases: finance },
      adminFinanceRuntime: createPaymentRecoveryLifecycle({
        recoverNext: finance.recoverNext,
        probeNext: () => finance.runPending(FINANCE_BATCH_SIZE),
        delayMs: FINANCE_RETRY_AFTER_MS,
        batchSize: FINANCE_BATCH_SIZE,
        close: () => financePersistence.close(),
      }),
      adminExceptionsRoute: {
        allowedOrigin,
        useCases: createAdminExceptionsUseCases({
          transactions: persistence.adminExceptionsTransactionManager,
          tokenPepper,
        }),
      },
      adminPaymentConfigurationRoute: {
        allowedOrigin,
        useCases: createAdminPaymentConfigurationUseCases({
          transactions:
            configurationPersistence.adminPaymentConfigurationTransactionManager,
          tokenPepper,
          deployedAccounts: payment.deployedAccounts,
        }),
      },
      adminPaymentConfigurationRuntime: releaseOnStop(configurationPersistence),
    });
  } catch {
    for (const lease of [
      persistence,
      financePersistence,
      configurationPersistence,
    ])
      void lease.close().catch(() => undefined);
    throw new TypeError("Administration construction failed");
  }
}
