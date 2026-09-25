import { expect, test, vi } from "vitest";
import { createApiApplication } from "./bootstrap.js";
import { createProductionApiApplication } from "./production-application.js";

const environment = {
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3002",
  FAN_SUPPORT_DATABASE_URL: [
    "postgresql://",
    "test",
    ":",
    "test",
    "@postgres:5432/checkout",
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
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

test("all three unconfigured checkout endpoints fail closed before processing request input", async () => {
  const app = await createApiApplication(environment, { logger });
  try {
    await app.init();
    for (const [method, url] of [
      ["POST", "/api/v1/cart/validate"],
      ["POST", "/api/v1/checkout/sessions"],
      [
        "GET",
        "/api/v1/checkout/sessions/10000000-0000-4000-8000-000000000001/status",
      ],
    ] as const) {
      const result = await app.inject({ method, url });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      });
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  } finally {
    await app.close();
  }
});

test("production forwards checkout capability and cleans its owned pool on bootstrap failure", async () => {
  const stop = vi.fn(async () => {});
  const checkout = {
    checkoutPreflightRoute: { marker: "checkout" },
    checkoutPreflightRuntime: { start: vi.fn(), stop },
  };
  const createCheckoutComposition = vi.fn(() => checkout);
  const createApplication = vi.fn(async () => {
    throw new Error("TEST bootstrap failed");
  });
  await expect(
    createProductionApiApplication(environment, {
      logger,
      factories: {
        createComposition: (() => ({
          reliableEventsRuntime: { stop: vi.fn() },
        })) as never,
        createCatalogComposition: (() => ({
          catalogDirectoryRuntime: { stop: vi.fn() },
        })) as never,
        createPublishedComposition: (() => ({
          publishedContentRuntime: { stop: vi.fn() },
        })) as never,
        createCartComposition: () => undefined,
        createCheckoutComposition,
        createApplication,
      } as never,
    }),
  ).rejects.toThrow("TEST bootstrap failed");
  expect(createCheckoutComposition).toHaveBeenCalledWith(environment);
  expect(createApplication).toHaveBeenCalledWith(
    environment,
    expect.objectContaining(checkout),
  );
  expect(stop).toHaveBeenCalledTimes(1);
});
