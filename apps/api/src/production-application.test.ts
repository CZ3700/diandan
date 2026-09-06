import { expect, test, vi } from "vitest";

import { createProductionApiApplication } from "./production-application.js";

const quietLogger = Object.freeze({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

test("passes the source-owned reliable-event route and lifecycle into the API bootstrap", async () => {
  const environment = Object.freeze({
    FAN_SUPPORT_DATABASE_URL: [
      "postgresql://",
      "api-user",
      ":",
      "test-password",
      "@postgres:5432/fan_support",
    ].join(""),
  });
  const composition = Object.freeze({
    paymentWebhookRoute: Object.freeze({
      receiver: Object.freeze({ receive: vi.fn() }),
      endpointPreflight: vi.fn(),
    }),
    reliableEventsRuntime: Object.freeze({
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }),
  });
  const application = Object.freeze({ marker: "api-application" });
  const createComposition = vi.fn(() => composition);
  const catalogComposition = Object.freeze({
    catalogDirectoryRoute: Object.freeze({
      readIdols: vi.fn(),
      readGifts: vi.fn(),
    }),
    catalogDirectoryRuntime: Object.freeze({
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }),
  });
  const createCatalogComposition = vi.fn(() => catalogComposition);
  const createApplication = vi.fn(async () => application);

  await expect(
    createProductionApiApplication(environment, {
      logger: quietLogger,
      factories: {
        createComposition: createComposition as never,
        createCatalogComposition: createCatalogComposition as never,
        createApplication: createApplication as never,
      },
    }),
  ).resolves.toBe(application);
  expect(createComposition).toHaveBeenCalledWith(environment, {
    logger: quietLogger,
  });
  expect(createCatalogComposition).toHaveBeenCalledWith(environment, {
    logger: quietLogger,
  });
  expect(createApplication).toHaveBeenCalledWith(environment, {
    logger: quietLogger,
    paymentWebhookRoute: composition.paymentWebhookRoute,
    reliableEventsRuntime: composition.reliableEventsRuntime,
    catalogDirectoryRoute: catalogComposition.catalogDirectoryRoute,
    catalogDirectoryRuntime: catalogComposition.catalogDirectoryRuntime,
  });
});

test("closes composed resources when application construction fails", async () => {
  const reliableStop = vi.fn(async () => undefined);
  const catalogStop = vi.fn(async () => undefined);
  await expect(
    createProductionApiApplication(
      {},
      {
        logger: quietLogger,
        factories: {
          createComposition: (() => ({
            paymentWebhookRoute: {},
            reliableEventsRuntime: { start: vi.fn(), stop: reliableStop },
          })) as never,
          createCatalogComposition: (() => ({
            catalogDirectoryRoute: {},
            catalogDirectoryRuntime: { start: vi.fn(), stop: catalogStop },
          })) as never,
          createApplication: (async () => {
            throw new Error("construction failed");
          }) as never,
        },
      },
    ),
  ).rejects.toThrow("construction failed");
  expect(reliableStop).toHaveBeenCalledTimes(1);
  expect(catalogStop).toHaveBeenCalledTimes(1);
});
