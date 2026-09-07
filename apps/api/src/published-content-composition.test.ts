import { expect, test, vi } from "vitest";
import { createPublishedContentComposition } from "./published-content-composition.js";
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

test("binds production public reads to configured PostgreSQL and trusted media origin without admin authority", async () => {
  const close = vi.fn(async () => undefined);
  const load = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }));
  const createPersistence = vi.fn(() => ({
    storefrontHomepageTransactionManager: {
      runInStorefrontHomepageTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ storefrontHomepage: { load } }),
    },
    publishedContentTransactionManager: {
      runInPublishedContentTransaction: async (
        work: (repositories: unknown) => unknown,
      ) => work({ publishedContent: { load } }),
    },
    close,
  }));
  const composition = createPublishedContentComposition(environment, {
    logger,
    factories: { createPersistence: createPersistence as never },
  });
  expect(Object.keys(composition).sort()).toEqual([
    "publishedContentRoute",
    "publishedContentRuntime",
    "publishedGiftCommerceRoute",
    "storefrontHomepageRoute",
  ]);
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
    composition.publishedContentRoute.useCases.execute({
      schemaVersion: 1,
      locator: { kind: "HOMEPAGE" },
      locale: "th",
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
  expect(load).toHaveBeenCalledOnce();
  await expect(
    composition.storefrontHomepageRoute.useCases.execute({
      schemaVersion: 1,
      locale: "ja",
    }),
  ).resolves.toMatchObject({ code: "NOT_FOUND" });
  expect(load).toHaveBeenCalledTimes(2);
  await composition.publishedContentRuntime.start();
  await Promise.all([
    composition.publishedContentRuntime.stop(),
    composition.publishedContentRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledOnce();
});
test("rejects incomplete production configuration before persistence acquisition", () => {
  const createPersistence = vi.fn();
  expect(() =>
    createPublishedContentComposition(
      { NODE_ENV: "test" },
      { logger, factories: { createPersistence } },
    ),
  ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
