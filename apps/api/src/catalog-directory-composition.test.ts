import { expect, test, vi } from "vitest";
import { createCatalogDirectoryComposition } from "./catalog-directory-composition.js";

const environment = Object.freeze({
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_DATABASE_URL: [
    "postgresql://",
    "test-user",
    ":",
    "test-password",
    "@postgres:5432/fan_support",
  ].join(""),
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://object-storage:9000",
  FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://object-storage:9000",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fan-support-media-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
  FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
  FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
    "TEST_OBJECT_STORAGE_SECRET_VALUE",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
});
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

test("connects real directory use cases to configured persistence and trusted media origin", async () => {
  const readIdols = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: "a".repeat(64),
    items: [],
    hasNextPage: false,
  }));
  const close = vi.fn(async () => undefined);
  const browseGifts = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: "a".repeat(64),
    items: [],
    totalItems: 0,
  }));
  const createPersistence = vi.fn(() => ({
    contentReadTransactionManager: {
      runInContentReadTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ catalogDirectory: { readIdols, browseGifts } }),
    },
    close,
  }));
  const composition = createCatalogDirectoryComposition(environment, {
    logger,
    factories: { createPersistence: createPersistence as never },
  });
  expect(createPersistence).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionString: environment.FAN_SUPPORT_DATABASE_URL,
    }),
    expect.objectContaining({
      catalogPublicMediaBaseUrl:
        environment.FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN,
    }),
  );
  await expect(
    composition.catalogDirectoryRoute.readIdols({
      schemaVersion: 1,
      locale: "en",
    }),
  ).resolves.toMatchObject({ outcome: "SUCCESS", items: [] });
  expect(readIdols).toHaveBeenCalledTimes(1);
  await expect(
    composition.catalogDirectoryRoute.browseGifts({
      schemaVersion: 1,
      locale: "th",
    }),
  ).resolves.toMatchObject({
    outcome: "SUCCESS",
    items: [],
    pageInfo: { page: 1, pageSize: 12 },
  });
  expect(browseGifts).toHaveBeenCalledTimes(1);
  await composition.catalogDirectoryRuntime.start();
  await Promise.all([
    composition.catalogDirectoryRuntime.stop(),
    composition.catalogDirectoryRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});

test("rejects missing media context instead of mounting a disconnected production catalog", () => {
  expect(() =>
    createCatalogDirectoryComposition({ NODE_ENV: "test" }, { logger }),
  ).toThrow();
});
