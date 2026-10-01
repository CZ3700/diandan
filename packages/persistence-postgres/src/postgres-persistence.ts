import { createStorefrontBrandRepository } from "./storefront-brand-repository.js";
import { createStorefrontBrandAuthorizationRepository } from "./admin-authorization-repository.js";
import type {
  StorefrontBrandRepositories,
  StorefrontBrandTransactionManager,
} from "@fan-support/persistence-port";
import { createInformationPageRepository } from "./information-pages-repository.js";
import { createWishGalleryRepository } from "./wish-gallery-repository.js";
import type {
  WishGalleryRepository,
  WishGalleryTransactionManager,
} from "@fan-support/persistence-port";
import { createInformationPageAuthorizationRepository } from "./admin-authorization-repository.js";
import type {
  InformationPageRepositories,
  InformationPageTransactionManager,
} from "@fan-support/persistence-port";
import { createStorefrontNavigationRepository } from "./storefront-navigation-repository.js";
import type {
  StorefrontNavigationRepositories,
  StorefrontNavigationTransactionManager,
} from "@fan-support/persistence-port";
import { createStorefrontThemeRepository } from "./storefront-theme-repository.js";
import type {
  StorefrontThemeRepositories,
  StorefrontThemeTransactionManager,
} from "@fan-support/persistence-port";
import { createHomeLayoutRepository } from "./home-layout-repository.js";
import type {
  HomeLayoutRepositories,
  HomeLayoutTransactionManager,
  CatalogDisplayOrderRepositories,
  CatalogDisplayOrderTransactionManager,
} from "@fan-support/persistence-port";
import { createCatalogDisplayOrderRepository } from "./catalog-display-order-repository.js";
import { createAdminExceptionsRepository } from "./admin-exceptions-repository.js";
import type {
  AdminExceptionsRepository,
  AdminExceptionsTransactionManager,
} from "@fan-support/persistence-port";
import { createAdminPaymentConfigurationRepository } from "./admin-payment-configuration-repository.js";
import type {
  AdminPaymentConfigurationRepository,
  AdminPaymentConfigurationTransactionManager,
} from "@fan-support/persistence-port";
import { createAdminFinanceRepository } from "./admin-finance-repository.js";
import type {
  AdminFinanceRepository,
  AdminFinanceTransactionManager,
} from "@fan-support/persistence-port";
import { acquirePaymentHealthClient } from "./payment-health-client.js";
import { createPaymentHealthRepository } from "./payment-health-repository.js";
import type {
  PaymentHealthRepository,
  PaymentHealthTransactionManager,
} from "@fan-support/persistence-port";
import { createAdminOrdersRepository } from "./admin-orders-repository.js";
import { createAdminLedgerRepository } from "./admin-ledger-repository.js";
import { createAdminArtistNoteRepository } from "./admin-artist-notes-repository.js";
import { createAdminOrderResendRepository } from "./admin-notification-resend-repository.js";
import { createAdminOrderResendNotificationRepository } from "./admin-notification-resend-worker.js";
import type {
  AdminLedgerRepositories,
  AdminLedgerTransactionManager,
  AdminArtistNoteRepositories,
  AdminArtistNoteTransactionManager,
  AdminOrdersRepositories,
  AdminOrdersTransactionManager,
} from "@fan-support/persistence-port";
import { createAdminAccessRepository } from "./admin-access-repository.js";
import { createAdminLocalLoginRepository } from "./admin-local-login-repository.js";
import { createAdminLocalAccountRepository } from "./admin-local-account-repository.js";
import { createAdminLocalStaffRepository } from "./admin-local-staff-repository.js";
import type {
  AdminAccessRepositories,
  AdminAccessTransactionManager,
  AdminLocalAccessRepositories,
  AdminLocalAccessTransactionManager,
} from "@fan-support/persistence-port";
import { createNotificationRepository } from "./notification-repository.js";
import { createNotificationSubmissionRepository } from "./notification-submission-repository.js";
import { createCommerceExpiryRepository } from "./commerce-expiry-repository.js";
import type {
  NotificationRepository,
  NotificationTransactionManager,
  NotificationSubmissionRepository,
  NotificationSubmissionTransactionManager,
  CommerceExpiryRepository,
  CommerceExpiryTransactionManager,
} from "@fan-support/persistence-port";
import { createOrderAccessRepository } from "./order-access-repository.js";
import type {
  OrderAccessRepository,
  OrderAccessTransactionManager,
} from "@fan-support/persistence-port";
import { createOrderPaymentApplicationRepository } from "./order-payment-application.js";
import type {
  OrderPaymentApplicationRepository,
  OrderPaymentApplicationTransactionManager,
} from "@fan-support/persistence-port";
import { createPaymentRuntimeRepository } from "./payment-runtime-repository.js";
import type {
  PaymentRuntimeRepositories,
  PaymentRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import { createCheckoutPreflightRepository } from "./checkout-preflight-repository.js";
import type {
  CheckoutPreflightRepositories,
  CheckoutPreflightTransactionManager,
} from "@fan-support/persistence-port";
import { createCartEditRepository } from "./cart-edit-repository.js";
import type {
  CartEditRepositories,
  CartEditTransactionManager,
} from "@fan-support/persistence-port";
import { createGiftCommerceAuthorizationRepository } from "./gift-commerce-authorization-repository.js";
import { createManagementCenterOperationRepository } from "./management-center-operation-repository.js";
import { createDailyPublicationRepository } from "./daily-publication-repository.js";
import type {
  ManagementCenterRepositories,
  ManagementCenterTransactionManager,
  ManagementMediaRepositories,
  ManagementMediaTransactionManager,
} from "@fan-support/persistence-port";
import { createGiftCommerceCatalogRepository } from "./gift-commerce-gift-repository.js";
import { createGiftCommercePricingRepository } from "./gift-commerce-pricing-repository.js";
import { createGiftCommerceInventoryRepository } from "./gift-commerce-inventory-repository.js";
import { createPublishedGiftCommerceRepository } from "./published-gift-commerce-repository.js";
import type {
  GiftCommerceRepositories,
  GiftCommerceTransactionManager,
  PublishedGiftCommerceTransactionManager,
  PublishedGiftCommerceRepository,
} from "@fan-support/persistence-port";
import { createAdminPreviewMediaRepository } from "./admin-preview-media-repository.js";
import type {
  AdminPreviewMediaTransactionManager,
  AdminPreviewMediaRepositories,
} from "@fan-support/persistence-port";
import { createTranslationTransferRepository } from "./translation-transfer-repository.js";
import type {
  TranslationTransferTransactionManager,
  TranslationTransferRepositories,
} from "@fan-support/persistence-port";
import { createTranslationWorkspaceRepository } from "./translation-workspace-repository.js";
import type {
  TranslationWorkspaceTransactionManager,
  TranslationWorkspaceRepositories,
} from "@fan-support/persistence-port";
import { createAdminCatalogRepository } from "./admin-catalog-repository.js";
import type {
  AdminCatalogTransactionManager,
  AdminCatalogRepositories,
} from "@fan-support/persistence-port";
import { createAdminSessionRepository } from "./admin-session-repository.js";
import type {
  AdminSessionTransactionManager,
  AdminSessionRepositories,
} from "@fan-support/persistence-port";
import { createPublicationAuthorizationRepository } from "./publication-authorization-repository.js";
import { createPublicationRuntimeRepository } from "./publication-runtime-repository.js";
import { createPublicationPurgeRepository } from "./publication-purge-repository.js";
import { createPublishedContentRepository } from "./published-content-repository.js";
import { createStorefrontCommerceRepository } from "./storefront-commerce-repository.js";
import { createCartRuntimeRepository } from "./cart-runtime-repository.js";
import type {
  CartRuntimeRepositories,
  CartRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import type {
  StorefrontCommerceTransactionManager,
  StorefrontCommerceRepositories,
} from "@fan-support/persistence-port";
import { createStorefrontSeoRepository } from "./storefront-seo-repository.js";
import type {
  StorefrontSeoTransactionManager,
  StorefrontSeoRepositories,
} from "@fan-support/persistence-port";
import { createStorefrontHomepageRepository } from "./storefront-homepage-repository.js";
import type {
  PublicationRuntimeTransactionManager,
  PublicationRuntimeRepositories,
  PublicationPurgeTransactionManager,
  PublicationPurgeRepositories,
  PublishedContentTransactionManager,
  PublishedContentRepositories,
  StorefrontHomepageTransactionManager,
  StorefrontHomepageRepositories,
} from "@fan-support/persistence-port";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import { createResourceManagementRepository } from "./resource-management-repository.js";
import { createResourceAuthorizationRepository } from "./resource-authorization-repository.js";
import { createBaseContentReviewRepository } from "./base-content-review-repository.js";
import { createBaseContentPreviewRepository } from "./base-content-preview-repository.js";
import {
  createAdminAuthorizationRepository,
  createHomeLayoutAuthorizationRepository,
} from "./admin-authorization-repository.js";
import { createContentReviewRepository } from "./content-review-repository.js";
import { createContentPreviewRepository } from "./content-preview-repository.js";
import { createMediaProcessingRepository } from "./media-processing-repository.js";
import { createContentDraftRepository } from "./content-draft-repository.js";
import { publicMediaUrlSchema } from "@fan-support/contracts";
import { createCatalogDirectoryRepository } from "./catalog-directory-repository.js";
import type {
  JsonValue,
  PublicationPreflightTransactionManager,
  PublicationPreflightRepositories,
  ResourceManagementTransactionManager,
  ResourceManagementRepositories,
  BaseContentTransactionManager,
  BaseContentRepositories,
  ContentAuthoringTransactionManager,
  ContentAuthoringRepositories,
  AdminContentTransactionManager,
  AdminContentRepositories,
  ContentDraftTransactionManager,
  ContentDraftRepositories,
  MediaProcessingTransactionManager,
  MediaProcessingRepositories,
  ContentReadTransactionManager,
  ContentReadRepositories,
  ReliableEventTransactionManager,
  ReliableEventTransactionRepositories,
  TransactionOptions,
  TransactionManager,
  TransactionRepositories,
} from "@fan-support/persistence-port";
import { transactionOptionsSchema } from "@fan-support/persistence-port";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import {
  normalizePostgresConnectionConfig,
  type NormalizedPostgresConnectionConfig,
  type PostgresConnectionConfig,
} from "./connection-config.js";
import { createIdempotencyRepository } from "./idempotency-repository.js";
import { createInventoryRepository } from "./inventory-repository.js";
import { createOutboxRepository } from "./outbox-repository.js";
import { createPostgresQueryLayer } from "./query-layer.js";
import {
  createReliableEventRepositories,
  type WebhookInboxPublisher,
} from "./reliable-event-repositories.js";
import {
  createPersistenceTransactionFailureError,
  createTransactionRunner,
  type TransactionClient,
} from "./transaction-runner.js";
import {
  classifyPostgresFailure,
  type PersistenceFailureClassification,
} from "./errors.js";

export interface PostgresPersistence {
  readonly homeLayoutTransactionManager: HomeLayoutTransactionManager;
  readonly catalogDisplayOrderTransactionManager: CatalogDisplayOrderTransactionManager;
  readonly informationPageTransactionManager: InformationPageTransactionManager;
  readonly storefrontNavigationTransactionManager: StorefrontNavigationTransactionManager;
  readonly storefrontBrandTransactionManager: StorefrontBrandTransactionManager;
  readonly storefrontThemeTransactionManager: StorefrontThemeTransactionManager;
  readonly wishGalleryTransactionManager: WishGalleryTransactionManager;
  readonly adminPaymentConfigurationTransactionManager: AdminPaymentConfigurationTransactionManager;
  readonly adminExceptionsTransactionManager: AdminExceptionsTransactionManager;
  readonly adminFinanceTransactionManager: AdminFinanceTransactionManager;
  readonly paymentHealthTransactionManager: PaymentHealthTransactionManager;
  readonly adminOrdersTransactionManager: AdminOrdersTransactionManager;
  readonly adminLedgerTransactionManager: AdminLedgerTransactionManager;
  readonly adminArtistNoteTransactionManager: AdminArtistNoteTransactionManager;
  readonly adminOrderResendNotificationTransactionManager: NotificationTransactionManager;
  readonly adminAccessTransactionManager: AdminAccessTransactionManager;
  readonly adminLocalAccessTransactionManager: AdminLocalAccessTransactionManager;
  readonly notificationTransactionManager: NotificationTransactionManager;
  readonly notificationSubmissionTransactionManager: NotificationSubmissionTransactionManager;
  readonly commerceExpiryTransactionManager: CommerceExpiryTransactionManager;
  readonly orderAccessTransactionManager: OrderAccessTransactionManager;
  readonly orderPaymentApplicationTransactionManager: OrderPaymentApplicationTransactionManager;
  readonly paymentRuntimeTransactionManager: PaymentRuntimeTransactionManager;
  readonly checkoutPreflightTransactionManager: CheckoutPreflightTransactionManager;
  readonly cartEditTransactionManager: CartEditTransactionManager;
  readonly cartRuntimeTransactionManager: CartRuntimeTransactionManager;
  readonly managementCenterTransactionManager: ManagementCenterTransactionManager;
  readonly managementMediaTransactionManager: ManagementMediaTransactionManager;
  readonly giftCommerceTransactionManager: GiftCommerceTransactionManager;
  readonly publishedGiftCommerceTransactionManager: PublishedGiftCommerceTransactionManager;
  readonly adminPreviewMediaTransactionManager: AdminPreviewMediaTransactionManager;
  readonly translationTransferTransactionManager: TranslationTransferTransactionManager;
  readonly translationWorkspaceTransactionManager: TranslationWorkspaceTransactionManager;
  readonly adminCatalogTransactionManager: AdminCatalogTransactionManager;
  readonly adminSessionTransactionManager: AdminSessionTransactionManager;
  readonly publicationRuntimeTransactionManager: PublicationRuntimeTransactionManager;
  readonly publicationPurgeTransactionManager: PublicationPurgeTransactionManager;
  readonly publishedContentTransactionManager: PublishedContentTransactionManager;
  readonly storefrontCommerceTransactionManager: StorefrontCommerceTransactionManager;
  readonly storefrontSeoTransactionManager: StorefrontSeoTransactionManager;
  readonly storefrontHomepageTransactionManager: StorefrontHomepageTransactionManager;
  readonly publicationPreflightTransactionManager: PublicationPreflightTransactionManager;
  readonly resourceManagementTransactionManager: ResourceManagementTransactionManager;
  readonly baseContentTransactionManager: BaseContentTransactionManager;
  readonly contentAuthoringTransactionManager: ContentAuthoringTransactionManager;
  readonly adminContentTransactionManager: AdminContentTransactionManager;
  readonly contentDraftTransactionManager: ContentDraftTransactionManager;
  readonly mediaProcessingTransactionManager: MediaProcessingTransactionManager;
  readonly transactionManager: TransactionManager;
  readonly contentReadTransactionManager: ContentReadTransactionManager;
  readonly reliableEventTransactionManager: ReliableEventTransactionManager;
  close(): Promise<void>;
}

export type PersistenceFailureNotice = PersistenceFailureClassification;

export type PostgresPersistenceOptions = Readonly<{
  /** Total acquisition/query/COMMIT budget for optional health telemetry only. */
  paymentHealthTimeoutMs?: number;
  onInfrastructureFailure?: (
    failure: PersistenceFailureNotice,
  ) => void | Promise<void>;
  publishWebhookInbox?: WebhookInboxPublisher;
  catalogPublicMediaBaseUrl?: string;
}>;

export interface ManagedPersistencePool {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
  on(event: "error", listener: (failure: unknown) => void): void;
  off(event: "error", listener: (failure: unknown) => void): void;
}

type PersistencePoolFactory = (
  config: NormalizedPostgresConnectionConfig,
) => ManagedPersistencePool;

function createNodePostgresPool(
  config: NormalizedPostgresConnectionConfig,
): ManagedPersistencePool {
  const pool = new Pool(config as PoolConfig);
  return {
    connect: async () => (await pool.connect()) as TransactionClient,
    end: () => pool.end(),
    on: (_event, listener) => {
      pool.on("error", listener);
    },
    off: (_event, listener) => {
      pool.off("error", listener);
    },
  };
}

function isCatalogMediaOrigin(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !publicMediaUrlSchema.safeParse(value).success
  )
    return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function isPersistenceOptions(
  value: unknown,
): value is PostgresPersistenceOptions | undefined {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    Object.keys(record).every(
      (key) =>
        key === "onInfrastructureFailure" ||
        key === "publishWebhookInbox" ||
        key === "catalogPublicMediaBaseUrl" ||
        key === "paymentHealthTimeoutMs",
    ) &&
    (record["paymentHealthTimeoutMs"] === undefined ||
      (typeof record["paymentHealthTimeoutMs"] === "number" &&
        Number.isSafeInteger(record["paymentHealthTimeoutMs"]) &&
        record["paymentHealthTimeoutMs"] >= 100 &&
        record["paymentHealthTimeoutMs"] <= 30000)) &&
    (record["onInfrastructureFailure"] === undefined ||
      typeof record["onInfrastructureFailure"] === "function") &&
    (record["catalogPublicMediaBaseUrl"] === undefined ||
      isCatalogMediaOrigin(record["catalogPublicMediaBaseUrl"])) &&
    (record["publishWebhookInbox"] === undefined ||
      typeof record["publishWebhookInbox"] === "function")
  );
}

export function createPostgresPersistenceWithPoolFactory(
  config: PostgresConnectionConfig,
  options: PostgresPersistenceOptions | undefined,
  poolFactory: PersistencePoolFactory,
): PostgresPersistence {
  const normalizedConfig = normalizePostgresConnectionConfig(config);
  if (normalizedConfig === undefined || !isPersistenceOptions(options)) {
    throw createPersistenceTransactionFailureError({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
  }
  let pool: ManagedPersistencePool;
  try {
    pool = poolFactory(normalizedConfig);
  } catch {
    throw createPersistenceTransactionFailureError({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
  }

  const handlePoolFailure = (error: unknown): void => {
    const failure = Object.freeze({ ...classifyPostgresFailure(error) });
    try {
      void Promise.resolve(options?.onInfrastructureFailure?.(failure)).catch(
        () => {
          // Asynchronous observer rejection is contained for the same reason.
        },
      );
    } catch {
      // An observer cannot turn an already-consumed pool failure into a crash.
    }
  };
  pool.on("error", handlePoolFailure);

  const runner = createTransactionRunner<TransactionRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => {
      const database = createPostgresQueryLayer(client as NodePgClient);
      return {
        idempotency: createIdempotencyRepository(database, transactionScope),
        outbox: createOutboxRepository(database, transactionScope),
        inventory: createInventoryRepository(database, transactionScope),
      };
    },
  });
  const financeRepositories = (
    client: TransactionClient,
    scope: Parameters<typeof createAdminOrdersRepository>[1],
  ) => {
    const database = createPostgresQueryLayer(client as NodePgClient);
    const inventory = createInventoryRepository(database, scope),
      outbox = createOutboxRepository(database, scope);
    return createAdminFinanceRepository(
      client,
      scope,
      outbox,
      inventory,
      createOrderPaymentApplicationRepository(client, inventory, outbox, scope),
    );
  };
  const adminPaymentConfigurationRunner =
    createTransactionRunner<AdminPaymentConfigurationRepository>({
      acquireClient: () =>
        acquirePaymentHealthClient(() => pool.connect(), 10000),
      createRepositories: createAdminPaymentConfigurationRepository,
    });
  const adminExceptionsRunner =
    createTransactionRunner<AdminExceptionsRepository>({
      acquireClient: () =>
        acquirePaymentHealthClient(() => pool.connect(), 10000),
      createRepositories: (client, scope) =>
        createAdminExceptionsRepository(
          client,
          scope,
          financeRepositories(client, scope),
          createAdminOrderResendRepository(client, scope),
        ),
    });
  const adminFinanceRunner = createTransactionRunner<AdminFinanceRepository>({
    acquireClient: async () => pool.connect(),
    createRepositories: financeRepositories,
  });
  const adminOrdersRunner = createTransactionRunner<AdminOrdersRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      adminOrders: createAdminOrdersRepository(client, scope, {
        publicMediaBaseUrl: options?.catalogPublicMediaBaseUrl ?? "",
      }),
      adminOrderResends: createAdminOrderResendRepository(client, scope),
    }),
  });
  const adminLedgerRunner = createTransactionRunner<AdminLedgerRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      adminLedger: createAdminLedgerRepository(client, scope),
    }),
  });
  const adminArtistNoteRunner =
    createTransactionRunner<AdminArtistNoteRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        adminArtistNotes: createAdminArtistNoteRepository(client, scope),
      }),
    });
  const adminOrderResendRunner =
    createTransactionRunner<NotificationRepository>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) =>
        createAdminOrderResendNotificationRepository(client, scope),
    });
  const notificationRunner = createTransactionRunner<NotificationRepository>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) =>
      createNotificationRepository(
        client,
        scope,
        createOutboxRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      ),
  });
  const notificationSubmissionRunner =
    createTransactionRunner<NotificationSubmissionRepository>({
      acquireClient: async () => pool.connect(),
      createRepositories: createNotificationSubmissionRepository,
    });
  const commerceExpiryRunner =
    createTransactionRunner<CommerceExpiryRepository>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) =>
        createCommerceExpiryRepository(
          client,
          createInventoryRepository(
            createPostgresQueryLayer(client as NodePgClient),
            scope,
          ),
          scope,
        ),
    });
  const orderAccessRunner = createTransactionRunner<OrderAccessRepository>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) =>
      createOrderAccessRepository(
        client,
        scope,
        options?.catalogPublicMediaBaseUrl ?? "",
      ),
  });
  const orderPaymentApplicationRunner =
    createTransactionRunner<OrderPaymentApplicationRepository>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => {
        const database = createPostgresQueryLayer(client as NodePgClient);
        return createOrderPaymentApplicationRepository(
          client,
          createInventoryRepository(database, scope),
          createOutboxRepository(database, scope),
          scope,
        );
      },
    });
  const paymentHealthRunner = createTransactionRunner<PaymentHealthRepository>({
    acquireClient: () =>
      acquirePaymentHealthClient(
        () => pool.connect(),
        options?.paymentHealthTimeoutMs ?? 3000,
      ),
    createRepositories: (client, scope) =>
      createPaymentHealthRepository(client, scope),
  });
  const paymentRuntimeRunner =
    createTransactionRunner<PaymentRuntimeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => {
        const database = createPostgresQueryLayer(client as NodePgClient);
        return {
          cartRuntime: createCartRuntimeRepository(client, scope),
          paymentRuntime: createPaymentRuntimeRepository(
            client,
            database,
            scope,
          ),
          idempotency: createIdempotencyRepository(database, scope),
          outbox: createOutboxRepository(database, scope),
        };
      },
    });
  const checkoutPreflightRunner =
    createTransactionRunner<CheckoutPreflightRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => {
        const database = createPostgresQueryLayer(client as NodePgClient);
        return {
          cartRuntime: createCartRuntimeRepository(client, scope),
          checkoutPreflight: createCheckoutPreflightRepository(
            client,
            scope,
            options!.catalogPublicMediaBaseUrl!,
          ),
          inventory: createInventoryRepository(database, scope),
          idempotency: createIdempotencyRepository(database, scope),
          outbox: createOutboxRepository(database, scope),
        };
      },
    });
  const cartRuntimeRunner = createTransactionRunner<CartRuntimeRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => {
      const database = createPostgresQueryLayer(client as NodePgClient);
      return {
        cartRuntime: createCartRuntimeRepository(client, scope),
        storefrontCommerce: createStorefrontCommerceRepository(
          client,
          scope,
          options!.catalogPublicMediaBaseUrl!,
        ),
        idempotency: createIdempotencyRepository(database, scope),
        outbox: createOutboxRepository(database, scope),
      };
    },
  });
  const cartEditRunner = createTransactionRunner<CartEditRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => {
      const database = createPostgresQueryLayer(client as NodePgClient);
      return {
        cartEdit: createCartEditRepository(client, scope),
        cartRuntime: createCartRuntimeRepository(client, scope),
        storefrontCommerce: createStorefrontCommerceRepository(
          client,
          scope,
          options!.catalogPublicMediaBaseUrl!,
        ),
        idempotency: createIdempotencyRepository(database, scope),
        outbox: createOutboxRepository(database, scope),
      };
    },
  });
  const publishWebhookInbox: WebhookInboxPublisher =
    options?.publishWebhookInbox ??
    (async () => {
      throw createPersistenceTransactionFailureError({
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      });
    });
  const reliableEventRunner =
    createTransactionRunner<ReliableEventTransactionRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, transactionScope) => {
        const database = createPostgresQueryLayer(client as NodePgClient);
        return {
          adminFinance: financeRepositories(client, transactionScope),
          orderPaymentApplication: createOrderPaymentApplicationRepository(
            client,
            createInventoryRepository(database, transactionScope),
            createOutboxRepository(database, transactionScope),
            transactionScope,
          ),
          ...createReliableEventRepositories(client, {
            transactionScope,
            publishWebhookInbox,
          }),
          outbox: createOutboxRepository(database, transactionScope),
        };
      },
    });
  const contentReadRunner = createTransactionRunner<ContentReadRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => ({
      catalogDirectory: createCatalogDirectoryRepository(client, {
        transactionScope,
        publicMediaBaseUrl: options!.catalogPublicMediaBaseUrl!,
      }),
    }),
  });
  const mediaProcessingRunner =
    createTransactionRunner<MediaProcessingRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, transactionScope) => ({
        mediaProcessing: createMediaProcessingRepository(
          client,
          transactionScope,
        ),
      }),
    });
  const contentDraftRunner = createTransactionRunner<ContentDraftRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => ({
      contentDrafts: createContentDraftRepository(client, transactionScope),
    }),
  });
  const homeLayoutRunner = createTransactionRunner<HomeLayoutRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createHomeLayoutAuthorizationRepository(client, scope),
      homeLayout: createHomeLayoutRepository(client, scope),
    }),
  });
  const catalogDisplayOrderRunner =
    createTransactionRunner<CatalogDisplayOrderRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createHomeLayoutAuthorizationRepository(client, scope),
        displayOrder: createCatalogDisplayOrderRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const wishGalleryRunner = createTransactionRunner<WishGalleryRepository>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) =>
      createWishGalleryRepository(
        client,
        scope,
        options?.catalogPublicMediaBaseUrl ?? "",
      ),
  });
  const storefrontBrandRunner =
    createTransactionRunner<StorefrontBrandRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createStorefrontBrandAuthorizationRepository(
          client,
          scope,
        ),
        storefrontBrand: createStorefrontBrandRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl,
        ),
        resources: createResourceManagementRepository(client, scope),
      }),
    });
  const storefrontThemeRunner =
    createTransactionRunner<StorefrontThemeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createHomeLayoutAuthorizationRepository(client, scope),
        storefrontTheme: createStorefrontThemeRepository(client, scope),
      }),
    });
  const informationPageRunner =
    createTransactionRunner<InformationPageRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createInformationPageAuthorizationRepository(
          client,
          scope,
        ),
        informationPages: createInformationPageRepository(client, scope),
      }),
    });
  const storefrontNavigationRunner =
    createTransactionRunner<StorefrontNavigationRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createHomeLayoutAuthorizationRepository(client, scope),
        storefrontNavigation: createStorefrontNavigationRepository(
          client,
          scope,
        ),
      }),
    });
  const adminContentRunner = createTransactionRunner<AdminContentRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createAdminAuthorizationRepository(client, scope),
      contentDrafts: createContentDraftRepository(client, scope),
      contentReviews: createContentReviewRepository(client, scope),
      contentPreviews: createContentPreviewRepository(client, scope),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const contentAuthoringRunner =
    createTransactionRunner<ContentAuthoringRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        contentAuthoring: createContentAuthoringRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const publicationRuntimeRunner =
    createTransactionRunner<PublicationRuntimeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createPublicationAuthorizationRepository(client, scope),
        publicationRuntime: createPublicationRuntimeRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const publicationPurgeRunner =
    createTransactionRunner<PublicationPurgeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        publicationPurge: createPublicationPurgeRepository(client, scope),
      }),
    });
  const publishedContentRunner =
    createTransactionRunner<PublishedContentRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        publishedContent: createPublishedContentRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const storefrontCommerceRunner =
    createTransactionRunner<StorefrontCommerceRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        storefrontCommerce: createStorefrontCommerceRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const storefrontSeoRunner =
    createTransactionRunner<StorefrontSeoRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        storefrontSeo: createStorefrontSeoRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const storefrontHomepageRunner =
    createTransactionRunner<StorefrontHomepageRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        storefrontHomepage: createStorefrontHomepageRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const publicationPreflightRunner =
    createTransactionRunner<PublicationPreflightRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        publicationPreflight: createPublicationPreflightRepository(
          client,
          scope,
        ),
      }),
    });
  const baseContentRunner = createTransactionRunner<BaseContentRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createAdminAuthorizationRepository(client, scope),
      baseContentReviews: createBaseContentReviewRepository(client, scope),
      baseContentPreviews: createBaseContentPreviewRepository(client, scope),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const resourceManagementRunner =
    createTransactionRunner<ResourceManagementRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createResourceAuthorizationRepository(client, scope),
        resources: createResourceManagementRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const managementRepositories = (
    client: TransactionClient,
    scope: Parameters<typeof createManagementCenterOperationRepository>[1],
  ): ManagementCenterRepositories => ({
    operations: createManagementCenterOperationRepository(
      client,
      scope,
      options?.catalogPublicMediaBaseUrl ?? "",
    ),
    publication: createDailyPublicationRepository(
      client,
      scope,
      options?.catalogPublicMediaBaseUrl ?? "",
    ),
  });
  const managementCenterRunner =
    createTransactionRunner<ManagementCenterRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: managementRepositories,
    });
  const managementMediaRunner =
    createTransactionRunner<ManagementMediaRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        ...managementRepositories(client, scope),
        resources: createResourceManagementRepository(client, scope),
      }),
    });
  const adminAccessRunner = createTransactionRunner<AdminAccessRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      adminAccess: createAdminAccessRepository(client, scope),
    }),
  });
  const adminLocalAccessRunner =
    createTransactionRunner<AdminLocalAccessRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        adminAccess: createAdminAccessRepository(client, scope),
        localLogin: createAdminLocalLoginRepository(client, scope),
        localAccount: createAdminLocalAccountRepository(client, scope),
        localStaff: createAdminLocalStaffRepository(client, scope),
      }),
    });
  const adminSessionRunner = createTransactionRunner<AdminSessionRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      adminSession: createAdminSessionRepository(client, scope),
    }),
  });
  const adminCatalogRunner = createTransactionRunner<AdminCatalogRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createAdminAuthorizationRepository(client, scope),
      adminCatalog: createAdminCatalogRepository(
        client,
        scope,
        options?.catalogPublicMediaBaseUrl,
      ),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const translationWorkspaceRunner =
    createTransactionRunner<TranslationWorkspaceRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        translationWorkspace: createTranslationWorkspaceRepository(
          client,
          scope,
        ),
      }),
    });
  const translationTransferRunner =
    createTransactionRunner<TranslationTransferRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        translationTransfers: createTranslationTransferRepository(
          client,
          scope,
        ),
        contentAuthoring: createContentAuthoringRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const adminPreviewMediaRunner =
    createTransactionRunner<AdminPreviewMediaRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        adminPreviewMedia: createAdminPreviewMediaRepository(client, scope),
      }),
    });
  const giftCommerceRunner = createTransactionRunner<GiftCommerceRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createGiftCommerceAuthorizationRepository(client, scope),
      contentAuthorization: createAdminAuthorizationRepository(client, scope),
      contentAuthoring: createContentAuthoringRepository(client, scope),
      catalog: createGiftCommerceCatalogRepository(
        client,
        scope,
        options?.catalogPublicMediaBaseUrl,
      ),
      pricing: createGiftCommercePricingRepository(client, scope),
      inventory: createGiftCommerceInventoryRepository(client, scope),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const publishedGiftCommerceRunner = createTransactionRunner<
    Readonly<{ publishedGiftCommerce: PublishedGiftCommerceRepository }>
  >({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      publishedGiftCommerce: createPublishedGiftCommerceRepository(
        client,
        scope,
        options!.catalogPublicMediaBaseUrl!,
      ),
    }),
  });
  let lifecycle: "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  let closePromise: Promise<void> | undefined;

  const transactionManager: TransactionManager = {
    async runInTransaction<Result extends JsonValue>(
      options: TransactionOptions,
      work: (repositories: TransactionRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN") {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      const parsedOptions = transactionOptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        throw createPersistenceTransactionFailureError({
          code: "INVALID_COMMAND",
          recovery: "NONE",
        });
      }
      return runner.run(parsedOptions.data, work);
    },
  };

  const reliableEventTransactionManager: ReliableEventTransactionManager = {
    async runInReliableEventTransaction<Result extends JsonValue>(
      options: TransactionOptions,
      work: (
        repositories: ReliableEventTransactionRepositories,
      ) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN") {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      const parsedOptions = transactionOptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        throw createPersistenceTransactionFailureError({
          code: "INVALID_COMMAND",
          recovery: "NONE",
        });
      }
      return reliableEventRunner.run(parsedOptions.data, work);
    },
  };

  const contentReadTransactionManager: ContentReadTransactionManager = {
    async runInContentReadTransaction<Result extends JsonValue>(
      work: (repositories: ContentReadRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (
        lifecycle !== "OPEN" ||
        options?.catalogPublicMediaBaseUrl === undefined
      ) {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      return contentReadRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };

  const mediaProcessingTransactionManager: MediaProcessingTransactionManager = {
    async runInMediaProcessingTransaction<Result extends JsonValue>(
      work: (repositories: MediaProcessingRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return mediaProcessingRunner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        work,
      );
    },
  };

  const close = (): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise;
    }
    lifecycle = "CLOSING";
    let endResult: Promise<void>;
    try {
      endResult = pool.end();
    } catch (error: unknown) {
      endResult = Promise.reject(error);
    }
    closePromise = endResult.then(
      () => {
        lifecycle = "CLOSED";
        try {
          pool.off("error", handlePoolFailure);
        } catch {
          // Listener cleanup cannot expose a provider-specific close failure.
        }
      },
      () => {
        lifecycle = "CLOSED";
        // A failed shutdown leaves this instance unusable. Keep consuming idle
        // pool errors, and require callers to construct a fresh adapter.
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      },
    );
    return closePromise;
  };

  const contentDraftTransactionManager: ContentDraftTransactionManager = {
    async runInContentDraftTransaction<Result extends JsonValue>(
      work: (repositories: ContentDraftRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return contentDraftRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };

  const adminContentTransactionManager: AdminContentTransactionManager = {
    async runInAdminContentTransaction(work) {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return adminContentRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };
  const contentAuthoringTransactionManager: ContentAuthoringTransactionManager =
    {
      async runInContentAuthoringTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return contentAuthoringRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    };
  const baseContentTransactionManager: BaseContentTransactionManager = {
    async runInBaseContentTransaction(work) {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return baseContentRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };
  return {
    translationWorkspaceTransactionManager: {
      async runInTranslationWorkspaceTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return translationWorkspaceRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    translationTransferTransactionManager: {
      async runInTranslationTransferTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return translationTransferRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    adminPreviewMediaTransactionManager: {
      async runInAdminPreviewMediaTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminPreviewMediaRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    managementCenterTransactionManager: {
      async runInManagementCenterTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return managementCenterRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    managementMediaTransactionManager: {
      async runInManagementMediaTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return managementMediaRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    giftCommerceTransactionManager: {
      async runInGiftCommerceTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return giftCommerceRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publishedGiftCommerceTransactionManager: {
      async runInPublishedGiftCommerceTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publishedGiftCommerceRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    adminAccessTransactionManager: {
      async runInAdminAccessTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminAccessRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    // Explicit row locks (identity, account, login) serialize built-in sign-in without serialization aborts.
    adminLocalAccessTransactionManager: {
      async runInAdminLocalAccessTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminLocalAccessRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminSessionTransactionManager: {
      async runInAdminSessionTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminSessionRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    adminCatalogTransactionManager: {
      async runInAdminCatalogTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminCatalogRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publicationRuntimeTransactionManager: {
      async runInPublicationRuntimeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationRuntimeRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publicationPurgeTransactionManager: {
      async runInPublicationPurgeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationPurgeRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    publishedContentTransactionManager: {
      async runInPublishedContentTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        if (options?.catalogPublicMediaBaseUrl === undefined)
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publishedContentRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    adminPaymentConfigurationTransactionManager: {
      async runInAdminPaymentConfigurationTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminPaymentConfigurationRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminExceptionsTransactionManager: {
      async runInAdminExceptionsTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminExceptionsRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminFinanceTransactionManager: {
      async runInAdminFinanceTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminFinanceRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminOrdersTransactionManager: {
      async runInAdminOrdersTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminOrdersRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminLedgerTransactionManager: {
      async runInAdminLedgerTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminLedgerRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminArtistNoteTransactionManager: {
      async runInAdminArtistNoteTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminArtistNoteRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminOrderResendNotificationTransactionManager: {
      async runInNotificationTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return adminOrderResendRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    notificationTransactionManager: {
      async runInNotificationTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return notificationRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    notificationSubmissionTransactionManager: {
      async runInNotificationSubmissionTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return notificationSubmissionRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    commerceExpiryTransactionManager: {
      async runInCommerceExpiryTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return commerceExpiryRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    orderAccessTransactionManager: {
      async runInOrderAccessTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return orderAccessRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    orderPaymentApplicationTransactionManager: {
      async runInOrderPaymentApplicationTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return orderPaymentApplicationRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    paymentHealthTransactionManager: {
      async runInPaymentHealthTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return paymentHealthRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    paymentRuntimeTransactionManager: {
      async runInPaymentRuntimeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return paymentRuntimeRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    checkoutPreflightTransactionManager: {
      async runInCheckoutPreflightTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return checkoutPreflightRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    cartRuntimeTransactionManager: {
      async runInCartRuntimeTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return cartRuntimeRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    cartEditTransactionManager: {
      async runInCartEditTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return cartEditRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    storefrontCommerceTransactionManager: {
      async runInStorefrontCommerceTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontCommerceRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    storefrontSeoTransactionManager: {
      async runInStorefrontSeoTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontSeoRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    storefrontHomepageTransactionManager: {
      async runInStorefrontHomepageTransaction(work) {
        if (
          lifecycle !== "OPEN" ||
          options?.catalogPublicMediaBaseUrl === undefined
        )
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontHomepageRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publicationPreflightTransactionManager: {
      async runInPublicationPreflightTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationPreflightRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    resourceManagementTransactionManager: {
      async runInResourceManagementTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return resourceManagementRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    baseContentTransactionManager,
    contentAuthoringTransactionManager,
    homeLayoutTransactionManager: {
      async runInHomeLayoutTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return homeLayoutRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    catalogDisplayOrderTransactionManager: {
      async runInCatalogDisplayOrderTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return catalogDisplayOrderRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    wishGalleryTransactionManager: {
      async runInWishGalleryTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return wishGalleryRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    storefrontBrandTransactionManager: {
      async runInStorefrontBrandTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontBrandRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    storefrontThemeTransactionManager: {
      async runInStorefrontThemeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontThemeRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    informationPageTransactionManager: {
      async runInInformationPageTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return informationPageRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    storefrontNavigationTransactionManager: {
      async runInStorefrontNavigationTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return storefrontNavigationRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    adminContentTransactionManager,
    transactionManager,
    reliableEventTransactionManager,
    contentReadTransactionManager,
    mediaProcessingTransactionManager,
    contentDraftTransactionManager,
    close,
  };
}

export function createPostgresPersistence(
  config: PostgresConnectionConfig,
  options?: PostgresPersistenceOptions,
): PostgresPersistence {
  return createPostgresPersistenceWithPoolFactory(
    config,
    options,
    createNodePostgresPool,
  );
}
