import type { StructuredLogger } from "@fan-support/observability";
import {
  createPublishedContentComposition,
  type PublishedContentComposition,
  type PublishedContentCompositionOptions,
} from "./published-content-composition.js";

import { createApiApplication } from "./bootstrap.js";
import {
  createCatalogDirectoryComposition,
  type CatalogDirectoryComposition,
  type CatalogDirectoryCompositionOptions,
} from "./catalog-directory-composition.js";
import {
  createApiReliableEventsComposition,
  type ApiReliableEventsComposition,
  type ApiReliableEventsCompositionOptions,
} from "./reliable-events-composition.js";

type ApiApplicationFactory = typeof createApiApplication;
type ReliableEventsCompositionFactory = (
  environment: Readonly<Record<string, string | undefined>>,
  options: ApiReliableEventsCompositionOptions,
) => ApiReliableEventsComposition;

export type ProductionApiApplicationOptions = Readonly<{
  logger: StructuredLogger;
  factories?: Readonly<{
    createApplication?: ApiApplicationFactory;
    createComposition?: ReliableEventsCompositionFactory;
    createCatalogComposition?: (
      environment: Readonly<Record<string, string | undefined>>,
      options: CatalogDirectoryCompositionOptions,
    ) => CatalogDirectoryComposition;
    createPublishedComposition?: (
      environment: Readonly<Record<string, string | undefined>>,
      options: PublishedContentCompositionOptions,
    ) => PublishedContentComposition;
  }>;
}>;

export async function createProductionApiApplication(
  environment: Readonly<Record<string, string | undefined>>,
  options: ProductionApiApplicationOptions,
): ReturnType<ApiApplicationFactory> {
  const createComposition =
    options.factories?.createComposition ?? createApiReliableEventsComposition;
  const createApplication =
    options.factories?.createApplication ?? createApiApplication;
  const composition = createComposition(environment, {
    logger: options.logger,
  });
  const createCatalogComposition =
    options.factories?.createCatalogComposition ??
    createCatalogDirectoryComposition;
  let catalog: CatalogDirectoryComposition | undefined;
  let published: PublishedContentComposition | undefined;
  try {
    catalog = createCatalogComposition(environment, { logger: options.logger });
    published = (
      options.factories?.createPublishedComposition ??
      createPublishedContentComposition
    )(environment, { logger: options.logger });
    return await createApplication(environment, {
      logger: options.logger,
      paymentWebhookRoute: composition.paymentWebhookRoute,
      reliableEventsRuntime: composition.reliableEventsRuntime,
      catalogDirectoryRoute: catalog.catalogDirectoryRoute,
      catalogDirectoryRuntime: catalog.catalogDirectoryRuntime,
      publishedContentRoute: published.publishedContentRoute,
      publishedGiftCommerceRoute: published.publishedGiftCommerceRoute,
      publishedContentRuntime: published.publishedContentRuntime,
    });
  } catch (error) {
    await Promise.allSettled([
      Promise.resolve().then(() => composition.reliableEventsRuntime.stop()),
      Promise.resolve().then(() => catalog?.catalogDirectoryRuntime.stop()),
      Promise.resolve().then(() => published?.publishedContentRuntime.stop()),
    ]);
    throw error;
  }
}
