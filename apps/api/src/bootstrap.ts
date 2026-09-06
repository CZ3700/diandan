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

import type { NestApplicationOptions } from "@nestjs/common";
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
  giftCommerceRoute?: GiftCommerceRouteDependencies;
  giftCommerceRuntime?: ApiLifecycleResource;
  publishedGiftCommerceRoute?: PublishedGiftCommerceRouteDependencies;
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
    | "API admin session"
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
    | "API resource management",
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
