import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { expect, test, vi } from "vitest";

import type { CreateApiApplicationOptions } from "./bootstrap.js";
import { createProductionApiApplication } from "./production-application.js";
import {
  adminEnvironment,
  completeProductionEnvironment,
  coreEnvironment,
  createFakeReliableEvents,
  paymentConnection,
  paymentHealthPolicy,
  quietLogger,
} from "./test-support/production-environment.js";

type RouteOptionKey = Extract<
  keyof CreateApiApplicationOptions,
  `${string}Route`
>;
// Adding a route option to the bootstrap without wiring it here fails typecheck, then this suite.
const everyRoute = {
  orderAccessRoute: true,
  cartRoute: true,
  cartEditRoute: true,
  checkoutPreflightRoute: true,
  paymentRuntimeRoute: true,
  managementCenterRoute: true,
  giftCommerceRoute: true,
  publishedGiftCommerceRoute: true,
  adminOrdersRoute: true,
  adminFinanceRoute: true,
  adminExceptionsRoute: true,
  adminPaymentConfigurationRoute: true,
  adminAccessRoute: true,
  adminSessionRoute: true,
  adminCatalogRoute: true,
  translationWorkspaceRoute: true,
  translationTransferRoute: true,
  adminPreviewMediaRoute: true,
  publicationRuntimeRoute: true,
  publishedContentRoute: true,
  storefrontHomepageRoute: true,
  storefrontSeoRoute: true,
  storefrontCommerceRoute: true,
  resourceManagementRoute: true,
  publicationPreflightRoute: true,
  baseContentRoute: true,
  paymentWebhookRoute: true,
  contentAuthoringRoute: true,
  adminContentRoute: true,
  catalogDirectoryRoute: true,
} satisfies Record<RouteOptionKey, true>;

const endpointId = "20000000-0000-4000-8000-000000000002";

function countingPersistence() {
  const closes = vi.fn();
  const createPersistence = vi.fn(
    (...args: Parameters<typeof createPostgresPersistence>) => {
      const persistence = createPostgresPersistence(...args);
      return {
        ...persistence,
        close: async () => {
          closes();
          await persistence.close();
        },
      };
    },
  );
  return { createPersistence, closes };
}

test("complete production configuration hands every API route dependency to the bootstrap", async () => {
  const application = Object.freeze({ marker: "api-application" });
  const createApplication = vi.fn(async () => application);
  const reliable = createFakeReliableEvents();
  await expect(
    createProductionApiApplication(completeProductionEnvironment, {
      logger: quietLogger,
      factories: {
        createApplication: createApplication as never,
        createReliableEvents: () => reliable.composition,
      },
    }),
  ).resolves.toBe(application);
  const options = createApplication.mock.calls[0]?.[1 as never] as
    CreateApiApplicationOptions | undefined;
  expect(
    Object.keys(everyRoute).filter(
      (key) => options?.[key as RouteOptionKey] === undefined,
    ),
  ).toEqual([]);
});

test("the production application answers admin, SEO, payment and webhook requests", async () => {
  const reliable = createFakeReliableEvents();
  const app = await createProductionApiApplication(
    completeProductionEnvironment,
    {
      logger: quietLogger,
      factories: { createReliableEvents: () => reliable.composition },
    },
  );
  try {
    await app.init();
    const admin = await app.inject({
      method: "POST",
      url: "/api/v1/admin/access/begin",
      headers: { "content-type": "application/json" },
      payload: { schemaVersion: 1, locale: "en" },
    });
    expect(admin.statusCode).toBe(403);
    expect(admin.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "ACCESS_DENIED",
    });
    const seo = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-seo/entity",
    });
    expect(seo.statusCode).toBe(400);
    expect(seo.json()).toMatchObject({ code: "INVALID_QUERY" });
    const capabilities = await app.inject({
      method: "GET",
      url: `/api/v1/checkout/sessions/${endpointId}/capabilities`,
    });
    // The real payment route validates the query; the unconfigured stub would answer 503 instead.
    expect(capabilities.statusCode).toBe(400);
    expect(capabilities.json()).toMatchObject({ code: "INVALID_COMMAND" });
    const webhook = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/payments/${endpointId}`,
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    // No verifier is deployed for this endpoint: rejected in memory, never by a database round trip.
    expect(webhook.statusCode).toBe(404);
    expect(reliable.endpointPreflight).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("core-only configuration leaves optional surfaces explicitly unavailable", async () => {
  const reliable = createFakeReliableEvents();
  const app = await createProductionApiApplication(coreEnvironment, {
    logger: quietLogger,
    factories: { createReliableEvents: () => reliable.composition },
  });
  try {
    await app.init();
    const admin = await app.inject({
      method: "POST",
      url: "/api/v1/admin/access/begin",
      headers: { "content-type": "application/json" },
      payload: { schemaVersion: 1, locale: "en" },
    });
    expect(admin.statusCode).toBe(404);
    const cart = await app.inject({ method: "GET", url: "/api/v1/cart" });
    expect(cart.statusCode).toBe(503);
    expect(cart.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    const seo = await app.inject({
      method: "GET",
      url: "/api/v1/storefront-seo/entity",
    });
    expect(seo.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

test("partial optional configuration fails before any database pool opens", async () => {
  const { createPersistence } = countingPersistence();
  for (const [environment, message] of [
    [
      {
        ...coreEnvironment,
        FAN_SUPPORT_ADMIN_ORIGIN: adminEnvironment.FAN_SUPPORT_ADMIN_ORIGIN,
      },
      "Invalid admin runtime configuration",
    ],
    [
      { ...coreEnvironment, FAN_SUPPORT_CART_KMS_REGION: "us-east-1" },
      "Invalid cart runtime configuration",
    ],
    [
      { ...coreEnvironment, ...adminEnvironment },
      "Administration requires key management",
    ],
  ] as const) {
    await expect(
      createProductionApiApplication(environment, {
        logger: quietLogger,
        factories: { createPersistence },
      }),
    ).rejects.toThrow(message);
  }
  expect(createPersistence).not.toHaveBeenCalled();
});

test("a configured account without deployed adapter code is a startup error, never a silent disable", async () => {
  const { createPersistence } = countingPersistence();
  await expect(
    createProductionApiApplication(
      {
        ...completeProductionEnvironment,
        FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
          paymentConnection,
        ]),
        FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
          paymentHealthPolicy,
        ]),
      },
      { logger: quietLogger, factories: { createPersistence } },
    ),
  ).rejects.toThrow("Payment account has no deployed adapter");
  expect(createPersistence).not.toHaveBeenCalled();
});

test("a bootstrap failure releases every shared pool and composed lifecycle exactly once", async () => {
  const { createPersistence, closes } = countingPersistence();
  const reliable = createFakeReliableEvents();
  await expect(
    createProductionApiApplication(completeProductionEnvironment, {
      logger: quietLogger,
      factories: {
        createPersistence,
        createReliableEvents: () => reliable.composition,
        createApplication: (async () => {
          throw new Error("TEST bootstrap failed");
        }) as never,
      },
    }),
  ).rejects.toThrow("TEST bootstrap failed");
  expect(createPersistence.mock.calls.length).toBeGreaterThan(0);
  expect(closes).toHaveBeenCalledTimes(createPersistence.mock.calls.length);
  expect(reliable.stop).toHaveBeenCalledTimes(1);
});
