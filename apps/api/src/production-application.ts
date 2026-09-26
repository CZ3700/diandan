import type { OidcIdentityProviderDependencies } from "@fan-support/identity-oidc";
import type { StructuredLogger } from "@fan-support/observability";
import type { PaymentConnectorFactory } from "@fan-support/payment-gateway";

import {
  createApiApplication,
  type ApiLifecycleResource,
  type CreateApiApplicationOptions,
} from "./bootstrap.js";
import { createCartRuntimeComposition } from "./cart-composition.js";
import { createCatalogDirectoryComposition } from "./catalog-directory-composition.js";
import { createCheckoutPreflightComposition } from "./checkout-composition.js";
import { createOrderAccessComposition } from "./order-access-composition.js";
import {
  assertDeployedPaymentAdapters,
  deployedPaymentConnectorFactories,
} from "./payment-deployed-adapters.js";
import {
  createPaymentWebhookVerifierDirectory,
  type PaymentWebhookVerifierRegistration,
} from "./payment-webhook-verifiers.js";
import { createProductionAdminComposition } from "./production-admin-composition.js";
import { resolveApiProductionConfig } from "./production-config.js";
import { createProductionPaymentComposition } from "./production-payment-composition.js";
import {
  createApiProductionResources,
  type ApiProductionResourceFactories,
} from "./production-resources.js";
import { createPublishedContentComposition } from "./published-content-composition.js";
import {
  createApiReliableEventsComposition,
  type ApiReliableEventsComposition,
  type ApiReliableEventsCompositionOptions,
} from "./reliable-events-composition.js";

type ApiApplicationFactory = typeof createApiApplication;

export type ProductionApiApplicationOptions = Readonly<{
  logger: StructuredLogger;
  /** Adapter code compiled into this release; defaults to the statically deployed set. */
  paymentConnectorFactories?: readonly PaymentConnectorFactory[];
  paymentWebhookVerifiers?: readonly PaymentWebhookVerifierRegistration[];
  factories?: Readonly<{
    createApplication?: ApiApplicationFactory;
    createReliableEvents?: (
      environment: Readonly<Record<string, string | undefined>>,
      options: ApiReliableEventsCompositionOptions,
    ) => ApiReliableEventsComposition;
    createPersistence?: ApiProductionResourceFactories["createPersistence"];
    identityTransport?: OidcIdentityProviderDependencies;
  }>;
}>;

function lifecyclesOf(component: object): ApiLifecycleResource[] {
  return Object.entries(component)
    .filter(
      ([name, value]) =>
        (name.endsWith("Runtime") || name.endsWith("Lifecycle")) &&
        typeof (value as Partial<ApiLifecycleResource> | undefined)?.stop ===
          "function",
    )
    .map(([, value]) => value as ApiLifecycleResource);
}

/**
 * The production composition root: configuration is read once, shared infrastructure is
 * created once, and every configured surface is wired. Unconfigured optional surfaces stay
 * explicitly unavailable; partially configured ones stop startup.
 */
export async function createProductionApiApplication(
  environment: Readonly<Record<string, string | undefined>>,
  options: ProductionApiApplicationOptions,
): ReturnType<ApiApplicationFactory> {
  const { logger } = options;
  const config = resolveApiProductionConfig(environment);
  const connectorFactories =
    options.paymentConnectorFactories ?? deployedPaymentConnectorFactories;
  assertDeployedPaymentAdapters(config.payment.connections, connectorFactories);
  const verifiers = createPaymentWebhookVerifierDirectory(
    options.paymentWebhookVerifiers ?? [],
  );
  const resources = createApiProductionResources(config, {
    logger,
    ...(options.factories?.createPersistence
      ? {
          factories: { createPersistence: options.factories.createPersistence },
        }
      : {}),
  });
  const owned: ApiLifecycleResource[] = [resources.lifecycle];
  function own<Component extends object>(component: Component): Component {
    owned.push(...lifecyclesOf(component));
    return component;
  }
  // The shared pool replaces each composition's own connection settings.
  const borrowPersistence = {
    createPersistence: () => resources.persistence(),
  };
  const publicMediaBaseUrl = config.storage.publicMediaOrigin;
  try {
    const reliable = own(
      (
        options.factories?.createReliableEvents ??
        createApiReliableEventsComposition
      )(environment, {
        logger,
        verifierForEndpoint: verifiers.verifierForEndpoint,
        ...(resources.keys === undefined
          ? {}
          : { keyManagement: resources.keys.keyManagement }),
      }),
    );
    const published = own(
      createPublishedContentComposition(environment, {
        logger,
        factories: borrowPersistence,
      }),
    );
    const catalog = own(
      createCatalogDirectoryComposition(environment, {
        logger,
        factories: borrowPersistence,
      }),
    );
    const keys = resources.keys;
    const commerce: Partial<CreateApiApplicationOptions> =
      keys === undefined
        ? {}
        : {
            ...own(
              createCartRuntimeComposition({
                openPersistence: resources.persistence,
                allowedOrigin: config.siteOrigin,
                publicMediaBaseUrl,
                ...keys,
              }),
            ),
            ...own(
              createCheckoutPreflightComposition({
                openPersistence: resources.persistence,
                allowedOrigin: config.siteOrigin,
                publicMediaBaseUrl,
                ...keys,
              }),
            ),
            ...(config.orderAccess === undefined
              ? {}
              : own(
                  createOrderAccessComposition({
                    openPersistence: resources.persistence,
                    publicMediaBaseUrl,
                    configuration: config.orderAccess,
                    ...keys,
                  }),
                )),
          };
    const payment =
      config.payment.runtime === undefined && config.admin === undefined
        ? undefined
        : createProductionPaymentComposition({
            config: config.payment,
            factories: connectorFactories,
            resources,
            publicMediaBaseUrl,
          });
    if (payment !== undefined) {
      owned.push(payment.paymentConfigurationRuntime);
      if (payment.payment !== undefined) own(payment.payment);
    }
    const admin =
      config.admin === undefined || payment === undefined
        ? {}
        : own(
            createProductionAdminComposition({
              config: config.admin,
              resources,
              payment: payment.projection,
              ...(options.factories?.identityTransport
                ? { identityTransport: options.factories.identityTransport }
                : {}),
            }),
          );
    return await (options.factories?.createApplication ?? createApiApplication)(
      environment,
      {
        ...commerce,
        ...(payment?.payment ?? {}),
        ...admin,
        logger,
        sharedResourcesRuntime: resources.lifecycle,
        ...(payment === undefined
          ? {}
          : {
              paymentConfigurationRuntime: payment.paymentConfigurationRuntime,
            }),
        paymentWebhookRoute: verifiers.gate(reliable.paymentWebhookRoute),
        reliableEventsRuntime: reliable.reliableEventsRuntime,
        catalogDirectoryRoute: catalog.catalogDirectoryRoute,
        catalogDirectoryRuntime: catalog.catalogDirectoryRuntime,
        publishedContentRoute: published.publishedContentRoute,
        publishedGiftCommerceRoute: published.publishedGiftCommerceRoute,
        storefrontHomepageRoute: published.storefrontHomepageRoute,
        storefrontCommerceRoute: published.storefrontCommerceRoute,
        storefrontSeoRoute: published.storefrontSeoRoute,
        publishedContentRuntime: published.publishedContentRuntime,
      },
    );
  } catch (error) {
    await Promise.allSettled(
      owned.map((lifecycle) => Promise.resolve().then(() => lifecycle.stop())),
    );
    throw error;
  }
}
