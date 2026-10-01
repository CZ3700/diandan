import {
  registerAdminOrdersRoute,
  type AdminOrdersRouteDependencies,
} from "./admin-orders-route.js";
import {
  registerAdminLedgerRoute,
  type AdminLedgerRouteDependencies,
} from "./admin-ledger-route.js";
import {
  registerAdminArtistNotesRoute,
  type AdminArtistNotesRouteDependencies,
} from "./admin-artist-notes-route.js";
import {
  registerAdminFinanceRoute,
  type AdminFinanceRouteDependencies,
} from "./admin-finance-route.js";
import {
  registerAdminPaymentConfigurationRoute,
  type AdminPaymentConfigurationRouteDependencies,
} from "./admin-payment-configuration-route.js";
import {
  registerAdminAccessRoute,
  registerAdminLocalAccessRoute,
  type AdminAccessRouteDependencies,
  type AdminLocalAccessRouteDependencies,
} from "./admin-access-route.js";
import {
  registerAdminAccountRoutes,
  type AdminAccountRouteDependencies,
} from "./admin-account-route.js";
import {
  registerStorefrontCommerceRoute,
  type StorefrontCommerceRouteDependencies,
} from "./storefront-commerce-route.js";
import {
  registerManagementCenterRoute,
  type ManagementCenterRouteDependencies,
} from "./management-center-route.js";
import {
  registerHomeLayoutRoute,
  registerPublicHomeLayoutRoute,
  type HomeLayoutRouteDependencies,
  type PublicHomeLayoutRouteDependencies,
} from "./home-layout-route.js";
import {
  registerCatalogDisplayOrderRoute,
  type CatalogDisplayOrderRouteDependencies,
} from "./catalog-display-order-route.js";
import {
  registerStorefrontThemeRoute,
  registerPublicStorefrontThemeRoute,
  type StorefrontThemeRouteDependencies,
  type PublicStorefrontThemeRouteDependencies,
} from "./storefront-theme-route.js";
import {
  registerStorefrontNavigationRoute,
  registerPublicStorefrontNavigationRoute,
  type StorefrontNavigationRouteDependencies,
  type PublicStorefrontNavigationRouteDependencies,
} from "./storefront-navigation-route.js";
import {
  registerInformationPagesRoute,
  registerPublicInformationPagesRoute,
  type InformationPagesRouteDependencies,
  type PublicInformationPagesRouteDependencies,
} from "./information-pages-route.js";
import {
  registerGiftCommerceRoute,
  type GiftCommerceRouteDependencies,
} from "./gift-commerce-route.js";
import {
  registerPublishedGiftCommerceRoute,
  type PublishedGiftCommerceRouteDependencies,
} from "./published-gift-commerce-route.js";
import {
  registerAdminSessionRoute,
  type AdminSessionRouteDependencies,
} from "./admin-session-route.js";
import {
  registerAdminCatalogRoute,
  registerTranslationWorkspaceRoute,
  registerTranslationTransferRoute,
  registerAdminPreviewMediaRoute,
  type AdminCatalogRouteDependencies,
  type TranslationWorkspaceRouteDependencies,
  type TranslationTransferRouteDependencies,
  type AdminPreviewMediaRouteDependencies,
} from "./admin-workspace-route.js";
import {
  registerPublicationRuntimeRoute,
  type PublicationRuntimeRouteDependencies,
} from "./publication-runtime-route.js";
import {
  registerPublishedContentRoute,
  type PublishedContentRouteDependencies,
} from "./published-content-route.js";
import {
  registerStorefrontHomepageRoute,
  type StorefrontHomepageRouteDependencies,
} from "./storefront-homepage-route.js";
import {
  registerPublicationPreflightRoute,
  type PublicationPreflightRouteDependencies,
} from "./publication-preflight-route.js";
import {
  registerResourceManagementRoute,
  type ResourceManagementRouteDependencies,
} from "./resource-management-route.js";
import {
  registerContentAuthoringRoute,
  type ContentAuthoringRouteDependencies,
} from "./admin-content-authoring-route.js";
import {
  registerAdminContentRoute,
  type AdminContentRouteOptions,
} from "./admin-content-route.js";
import "reflect-metadata";
import {
  registerAdminExceptionsRoute,
  type AdminExceptionsRouteDependencies,
} from "./admin-exceptions-route.js";

import type { NestApplicationOptions } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  createStructuredLogger,
  type StructuredLogger,
} from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";

import { AppModule } from "./app.module.js";
import {
  registerOrderAccessRoute,
  type OrderAccessRouteDependencies,
} from "./order-access-route.js";
import { registerCartRoute, type CartRouteDependencies } from "./cart-route.js";
import {
  registerCartEditRoute,
  type CartEditRouteDependencies,
} from "./cart-edit-route.js";
import {
  registerCheckoutPreflightRoute,
  type CheckoutPreflightRouteDependencies,
} from "./checkout-preflight-route.js";
import {
  registerPaymentRuntimeRoute,
  type PaymentRuntimeRouteDependencies,
} from "./payment-runtime-route.js";
import {
  registerCatalogDirectoryRoute,
  type CatalogDirectoryRouteOptions,
} from "./catalog-directory-route.js";
import {
  registerPaymentWebhookRoute,
  type PaymentWebhookRouteOptions,
} from "./payment-webhook-route.js";
import { assertApiRuntimeConfig } from "./runtime-config.js";
import { SafeHttpExceptionFilter } from "./safe-http-exception.filter.js";

export const apiNestApplicationOptions = Object.freeze({
  abortOnError: false,
  logger: false,
}) satisfies Readonly<NestApplicationOptions>;

export type ApiLifecycleResource = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type CreateApiApplicationOptions = Readonly<{
  orderAccessRoute?: OrderAccessRouteDependencies;
  orderAccessRuntime?: ApiLifecycleResource;
  cartRoute?: CartRouteDependencies;
  cartEditRoute?: CartEditRouteDependencies;
  cartRuntime?: ApiLifecycleResource;
  checkoutPreflightRoute?: CheckoutPreflightRouteDependencies;
  checkoutPreflightRuntime?: ApiLifecycleResource;
  paymentRuntimeRoute?: PaymentRuntimeRouteDependencies;
  paymentRuntime?: ApiLifecycleResource;
  /** Refreshes the published payment directory; starts before payment recovery reads it. */
  paymentConfigurationRuntime?: ApiLifecycleResource;
  /** Owner holds on the process-wide pools; each pool closes after its last borrower stops. */
  sharedResourcesRuntime?: ApiLifecycleResource;
  managementCenterRoute?: ManagementCenterRouteDependencies;
  managementCenterRuntime?: ApiLifecycleResource;
  homeLayoutRoute?: HomeLayoutRouteDependencies;
  catalogDisplayOrderRoute?: CatalogDisplayOrderRouteDependencies;
  publicHomeLayoutRoute?: PublicHomeLayoutRouteDependencies;
  storefrontThemeRoute?: StorefrontThemeRouteDependencies;
  publicStorefrontThemeRoute?: PublicStorefrontThemeRouteDependencies;
  storefrontNavigationRoute?: StorefrontNavigationRouteDependencies;
  publicStorefrontNavigationRoute?: PublicStorefrontNavigationRouteDependencies;
  informationPagesRoute?: InformationPagesRouteDependencies;
  publicInformationPagesRoute?: PublicInformationPagesRouteDependencies;
  giftCommerceRoute?: GiftCommerceRouteDependencies;
  giftCommerceRuntime?: ApiLifecycleResource;
  publishedGiftCommerceRoute?: PublishedGiftCommerceRouteDependencies;
  adminOrdersRoute?: AdminOrdersRouteDependencies;
  adminLedgerRoute?: AdminLedgerRouteDependencies;
  adminLedgerRuntime?: ApiLifecycleResource;
  adminArtistNotesRoute?: AdminArtistNotesRouteDependencies;
  adminArtistNotesRuntime?: ApiLifecycleResource;
  adminOrdersRuntime?: ApiLifecycleResource;
  adminFinanceRoute?: AdminFinanceRouteDependencies;
  adminFinanceRuntime?: ApiLifecycleResource;
  adminExceptionsRoute?: AdminExceptionsRouteDependencies;
  adminExceptionsRuntime?: ApiLifecycleResource;
  adminPaymentConfigurationRoute?: AdminPaymentConfigurationRouteDependencies;
  adminPaymentConfigurationRuntime?: ApiLifecycleResource;
  adminAccessRoute?: AdminAccessRouteDependencies;
  adminLocalAccessRoute?: AdminLocalAccessRouteDependencies;
  adminAccountRoute?: AdminAccountRouteDependencies;
  adminAccessRuntime?: ApiLifecycleResource;
  adminSessionRoute?: AdminSessionRouteDependencies;
  adminSessionRuntime?: ApiLifecycleResource;
  adminCatalogRoute?: AdminCatalogRouteDependencies;
  translationWorkspaceRoute?: TranslationWorkspaceRouteDependencies;
  translationTransferRoute?: TranslationTransferRouteDependencies;
  adminPreviewMediaRoute?: AdminPreviewMediaRouteDependencies;
  adminWorkspaceRuntime?: ApiLifecycleResource;
  publicationRuntimeRoute?: PublicationRuntimeRouteDependencies;
  publicationRuntimeLifecycle?: ApiLifecycleResource;
  publishedContentRoute?: PublishedContentRouteDependencies;
  storefrontHomepageRoute?: StorefrontHomepageRouteDependencies;
  storefrontSeoRoute?: StorefrontSeoRouteDependencies;
  storefrontCommerceRoute?: StorefrontCommerceRouteDependencies;
  publishedContentRuntime?: ApiLifecycleResource;
  resourceManagementRoute?: ResourceManagementRouteDependencies;
  resourceManagementRuntime?: ApiLifecycleResource;
  publicationPreflightRoute?: PublicationPreflightRouteDependencies;
  publicationPreflightRuntime?: ApiLifecycleResource;
  baseContentRoute?: BaseContentRouteDependencies;
  baseContentRuntime?: ApiLifecycleResource;
  logger?: StructuredLogger;
  paymentWebhookRoute?: PaymentWebhookRouteOptions;
  reliableEventsRuntime?: ApiLifecycleResource;
  contentAuthoringRoute?: ContentAuthoringRouteDependencies;
  contentAuthoringRuntime?: ApiLifecycleResource;
  adminContentRoute?: AdminContentRouteOptions;
  adminContentRuntime?: ApiLifecycleResource;
  catalogDirectoryRoute?: CatalogDirectoryRouteOptions;
  catalogDirectoryRuntime?: ApiLifecycleResource;
}>;

function registerApiLifecycle(
  adapter: FastifyAdapter,
  runtime: ApiLifecycleResource | undefined,
  name:
    | "API shared resources"
    | "API payment configuration projection"
    | "API admin access"
    | "API admin orders"
    | "API admin ledger"
    | "API admin artist notes"
    | "API admin finance"
    | "API admin exceptions"
    | "API payment configuration"
    | "API admin session"
    | "API cart"
    | "API order access"
    | "API checkout preflight"
    | "API payment runtime"
    | "API admin workspace"
    | "API gift commerce"
    | "API reliable events"
    | "API catalog directory"
    | "API admin content"
    | "API content authoring"
    | "API base content"
    | "API publication preflight"
    | "API publication runtime"
    | "API published content"
    | "API resource management"
    | "API management center",
): void {
  if (runtime === undefined) {
    return;
  }
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= runtime.stop();
    return stopPromise;
  };
  adapter.getInstance().addHook("onReady", async () => {
    try {
      await runtime.start();
    } catch {
      await stop().catch(() => undefined);
      throw new Error(`${name} failed to start`);
    }
  });
  adapter.getInstance().addHook("onClose", async () => {
    try {
      await stop();
    } catch {
      throw new Error(`${name} failed to stop`);
    }
  });
}

export async function createApiApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  assertApiRuntimeConfig(environment);
  const logger = options.logger ?? createStructuredLogger({ service: "api" });
  const adapter = new FastifyAdapter({ logger: false });
  registerFastifyObservability(adapter.getInstance(), {
    service: "api",
    logger,
  });
  registerApiLifecycle(
    adapter,
    options.sharedResourcesRuntime,
    "API shared resources",
  );
  registerApiLifecycle(adapter, options.cartRuntime, "API cart");
  registerApiLifecycle(adapter, options.orderAccessRuntime, "API order access");
  registerApiLifecycle(
    adapter,
    options.paymentConfigurationRuntime,
    "API payment configuration projection",
  );
  registerApiLifecycle(adapter, options.paymentRuntime, "API payment runtime");
  registerApiLifecycle(
    adapter,
    options.checkoutPreflightRuntime,
    "API checkout preflight",
  );
  const unavailable = (_request: unknown, reply: FastifyReply) =>
    reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow")
      .header("referrer-policy", "no-referrer")
      .code(503)
      .send({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      });
  if (options.orderAccessRoute)
    registerOrderAccessRoute(adapter.getInstance(), options.orderAccessRoute);
  else
    for (const [url, method] of [
      ["/api/v1/order-access/exchange", "POST"],
      ["/api/v1/checkout/sessions/:checkoutSessionId/order-access", "POST"],
      ["/api/v1/order-access/revoke", "POST"],
      ["/api/v1/order-access/locate", "POST"],
      ["/api/v1/orders/:publicOrderId", "GET"],
      [
        "/api/v1/orders/:publicOrderId/delivery-proofs/:proofId/:rendition",
        "GET",
      ],
    ] as const)
      adapter.getInstance().route({
        url,
        method,
        bodyLimit: 1024,
        exposeHeadRoute: false,
        onRequest: async (request, reply) => unavailable(request, reply),
        handler: unavailable,
      });
  if (options.paymentRuntimeRoute)
    registerPaymentRuntimeRoute(
      adapter.getInstance(),
      options.paymentRuntimeRoute,
    );
  else
    for (const [url, method] of [
      ["/api/v1/checkout/current/status", "GET"],
      ["/api/v1/checkout/sessions/:checkoutSessionId/capabilities", "GET"],
      ["/api/v1/checkout/sessions/:checkoutSessionId/attempts", "POST"],
      [
        "/api/v1/checkout/sessions/:checkoutSessionId/attempts/:attemptId",
        "GET",
      ],
      [
        "/api/v1/checkout/sessions/:checkoutSessionId/attempts/:attemptId/recover",
        "POST",
      ],
    ] as const)
      adapter.getInstance().route({
        url,
        method,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        onRequest: async (request, reply) => unavailable(request, reply),
        handler: unavailable,
      });
  if (options.checkoutPreflightRoute)
    registerCheckoutPreflightRoute(
      adapter.getInstance(),
      options.checkoutPreflightRoute,
    );
  else
    for (const [url, method] of [
      ["/api/v1/cart/validate", "POST"],
      ["/api/v1/checkout/sessions", "POST"],
      ["/api/v1/checkout/sessions/:checkoutSessionId/status", "GET"],
    ] as const) {
      adapter.getInstance().route({
        url,
        method,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        onRequest: async (request, reply) => unavailable(request, reply),
        handler: unavailable,
      });
    }
  if (options.cartRoute)
    registerCartRoute(adapter.getInstance(), options.cartRoute);
  else {
    for (const [url, method] of [
      ["/api/v1/carts", "POST"],
      ["/api/v1/cart", "GET"],
      ["/api/v1/cart/items", "POST"],
    ] as const) {
      adapter.getInstance().route({
        url,
        method,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        onRequest: async (request, reply) => unavailable(request, reply),
        handler: unavailable,
      });
    }
  }
  if (options.cartEditRoute)
    registerCartEditRoute(adapter.getInstance(), options.cartEditRoute);
  else
    for (const [url, method] of [
      ["/api/v1/cart/items/:itemId", "PATCH"],
      ["/api/v1/cart/items/:itemId", "DELETE"],
      ["/api/v1/cart/items/:itemId/editor", "POST"],
    ] as const)
      adapter.getInstance().route({
        url,
        method,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        onRequest: async (request, reply) => unavailable(request, reply),
        handler: unavailable,
      });
  registerApiLifecycle(adapter, options.adminAccessRuntime, "API admin access");
  registerApiLifecycle(
    adapter,
    options.adminSessionRuntime,
    "API admin session",
  );
  registerApiLifecycle(
    adapter,
    options.giftCommerceRuntime,
    "API gift commerce",
  );
  if (options.giftCommerceRoute)
    registerGiftCommerceRoute(adapter.getInstance(), options.giftCommerceRoute);
  if (options.publishedGiftCommerceRoute)
    registerPublishedGiftCommerceRoute(
      adapter.getInstance(),
      options.publishedGiftCommerceRoute,
    );
  registerApiLifecycle(
    adapter,
    options.adminWorkspaceRuntime,
    "API admin workspace",
  );
  registerApiLifecycle(adapter, options.adminOrdersRuntime, "API admin orders");
  registerApiLifecycle(adapter, options.adminLedgerRuntime, "API admin ledger");
  registerApiLifecycle(
    adapter,
    options.adminArtistNotesRuntime,
    "API admin artist notes",
  );
  registerApiLifecycle(
    adapter,
    options.adminFinanceRuntime,
    "API admin finance",
  );
  if (options.adminFinanceRoute)
    registerAdminFinanceRoute(adapter.getInstance(), options.adminFinanceRoute);
  registerApiLifecycle(
    adapter,
    options.adminExceptionsRuntime,
    "API admin exceptions",
  );
  if (options.adminExceptionsRoute)
    registerAdminExceptionsRoute(
      adapter.getInstance(),
      options.adminExceptionsRoute,
    );
  registerApiLifecycle(
    adapter,
    options.adminPaymentConfigurationRuntime,
    "API payment configuration",
  );
  if (options.adminPaymentConfigurationRoute)
    registerAdminPaymentConfigurationRoute(
      adapter.getInstance(),
      options.adminPaymentConfigurationRoute,
    );
  if (options.adminOrdersRoute)
    registerAdminOrdersRoute(adapter.getInstance(), options.adminOrdersRoute);
  if (options.adminLedgerRoute)
    registerAdminLedgerRoute(adapter.getInstance(), options.adminLedgerRoute);
  if (options.adminArtistNotesRoute)
    registerAdminArtistNotesRoute(
      adapter.getInstance(),
      options.adminArtistNotesRoute,
    );
  if (options.adminAccessRoute)
    registerAdminAccessRoute(adapter.getInstance(), options.adminAccessRoute);
  if (options.adminLocalAccessRoute)
    registerAdminLocalAccessRoute(
      adapter.getInstance(),
      options.adminLocalAccessRoute,
    );
  if (options.adminAccountRoute)
    registerAdminAccountRoutes(
      adapter.getInstance(),
      options.adminAccountRoute,
    );
  if (options.adminSessionRoute)
    registerAdminSessionRoute(adapter.getInstance(), options.adminSessionRoute);
  if (options.adminCatalogRoute)
    registerAdminCatalogRoute(adapter.getInstance(), options.adminCatalogRoute);
  if (options.translationWorkspaceRoute)
    registerTranslationWorkspaceRoute(
      adapter.getInstance(),
      options.translationWorkspaceRoute,
    );
  if (options.translationTransferRoute)
    registerTranslationTransferRoute(
      adapter.getInstance(),
      options.translationTransferRoute,
    );
  if (options.adminPreviewMediaRoute)
    registerAdminPreviewMediaRoute(
      adapter.getInstance(),
      options.adminPreviewMediaRoute,
    );
  registerApiLifecycle(
    adapter,
    options.reliableEventsRuntime,
    "API reliable events",
  );
  registerApiLifecycle(
    adapter,
    options.catalogDirectoryRuntime,
    "API catalog directory",
  );
  registerApiLifecycle(
    adapter,
    options.adminContentRuntime,
    "API admin content",
  );
  registerApiLifecycle(
    adapter,
    options.contentAuthoringRuntime,
    "API content authoring",
  );
  if (options.contentAuthoringRoute !== undefined)
    registerContentAuthoringRoute(
      adapter.getInstance(),
      options.contentAuthoringRoute,
    );
  registerApiLifecycle(
    adapter,
    options.resourceManagementRuntime,
    "API resource management",
  );
  registerApiLifecycle(
    adapter,
    options.managementCenterRuntime,
    "API management center",
  );
  if (options.managementCenterRoute !== undefined)
    registerManagementCenterRoute(
      adapter.getInstance(),
      options.managementCenterRoute,
    );
  if (options.homeLayoutRoute !== undefined)
    registerHomeLayoutRoute(adapter.getInstance(), options.homeLayoutRoute);
  if (options.catalogDisplayOrderRoute !== undefined)
    registerCatalogDisplayOrderRoute(
      adapter.getInstance(),
      options.catalogDisplayOrderRoute,
    );
  if (options.publicHomeLayoutRoute !== undefined)
    registerPublicHomeLayoutRoute(
      adapter.getInstance(),
      options.publicHomeLayoutRoute,
    );
  if (options.storefrontThemeRoute !== undefined)
    registerStorefrontThemeRoute(
      adapter.getInstance(),
      options.storefrontThemeRoute,
    );
  if (options.publicStorefrontThemeRoute !== undefined)
    registerPublicStorefrontThemeRoute(
      adapter.getInstance(),
      options.publicStorefrontThemeRoute,
    );
  if (options.storefrontNavigationRoute !== undefined)
    registerStorefrontNavigationRoute(
      adapter.getInstance(),
      options.storefrontNavigationRoute,
    );
  if (options.publicStorefrontNavigationRoute !== undefined)
    registerPublicStorefrontNavigationRoute(
      adapter.getInstance(),
      options.publicStorefrontNavigationRoute,
    );
  if (options.informationPagesRoute !== undefined)
    registerInformationPagesRoute(
      adapter.getInstance(),
      options.informationPagesRoute,
    );
  if (options.publicInformationPagesRoute !== undefined)
    registerPublicInformationPagesRoute(
      adapter.getInstance(),
      options.publicInformationPagesRoute,
    );
  if (options.resourceManagementRoute !== undefined)
    registerResourceManagementRoute(
      adapter.getInstance(),
      options.resourceManagementRoute,
    );
  registerApiLifecycle(
    adapter,
    options.publicationPreflightRuntime,
    "API publication preflight",
  );
  if (options.publicationPreflightRoute !== undefined)
    registerPublicationPreflightRoute(
      adapter.getInstance(),
      options.publicationPreflightRoute,
    );
  registerApiLifecycle(
    adapter,
    options.publicationRuntimeLifecycle,
    "API publication runtime",
  );
  registerApiLifecycle(
    adapter,
    options.publishedContentRuntime,
    "API published content",
  );
  if (options.publicationRuntimeRoute !== undefined)
    registerPublicationRuntimeRoute(
      adapter.getInstance(),
      options.publicationRuntimeRoute,
    );
  if (options.publishedContentRoute !== undefined)
    registerPublishedContentRoute(
      adapter.getInstance(),
      options.publishedContentRoute,
    );
  if (options.storefrontCommerceRoute !== undefined)
    registerStorefrontCommerceRoute(
      adapter.getInstance(),
      options.storefrontCommerceRoute,
    );
  if (options.storefrontHomepageRoute !== undefined)
    registerStorefrontHomepageRoute(
      adapter.getInstance(),
      options.storefrontHomepageRoute,
    );
  if (options.storefrontSeoRoute !== undefined)
    registerStorefrontSeoRoute(
      adapter.getInstance(),
      options.storefrontSeoRoute,
    );
  registerApiLifecycle(adapter, options.baseContentRuntime, "API base content");
  if (options.baseContentRoute !== undefined)
    registerBaseContentRoute(adapter.getInstance(), options.baseContentRoute);
  if (options.adminContentRoute !== undefined)
    registerAdminContentRoute(adapter.getInstance(), options.adminContentRoute);
  if (options.catalogDirectoryRoute !== undefined) {
    registerCatalogDirectoryRoute(
      adapter.getInstance(),
      options.catalogDirectoryRoute,
    );
  }
  if (options.paymentWebhookRoute !== undefined) {
    registerPaymentWebhookRoute(
      adapter.getInstance(),
      options.paymentWebhookRoute,
    );
  }

  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    apiNestApplicationOptions,
  );
  application.useGlobalFilters(new SafeHttpExceptionFilter());
  return application;
}
import {
  registerBaseContentRoute,
  type BaseContentRouteDependencies,
} from "./base-content-route.js";
import {
  registerStorefrontSeoRoute,
  type StorefrontSeoRouteDependencies,
} from "./storefront-seo-route.js";
