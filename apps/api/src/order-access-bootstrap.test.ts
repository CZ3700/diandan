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
    "@postgres:5432/orders",
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

test("all unconfigured order access routes reject before processing raw credentials", async () => {
  const app = await createApiApplication(environment, { logger });
  try {
    await app.init();
    for (const [method, url] of [
      ["POST", "/api/v1/order-access/exchange"],
      [
        "POST",
        "/api/v1/checkout/sessions/10000000-0000-4000-8000-000000000001/order-access",
      ],
      ["POST", "/api/v1/order-access/revoke"],
      ["GET", "/api/v1/orders/10000000-0000-4000-8000-000000000001"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      });
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  } finally {
    await app.close();
  }
});

test("production registers order access and stops its resource on construction failure", async () => {
  const stop = vi.fn(async () => {});
  const orderAccess = {
    orderAccessRoute: { marker: "order-access" },
    orderAccessRuntime: { start: vi.fn(), stop },
  };
  const createOrderAccessComposition = vi.fn(() => orderAccess);
  const createApplication = vi.fn(async () => {
    throw new Error("TEST construction failure");
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
        createCheckoutComposition: () => undefined,
        createPaymentComposition: () => undefined,
        createOrderAccessComposition,
        createApplication,
      } as never,
    }),
  ).rejects.toThrow("TEST construction failure");
  expect(createOrderAccessComposition).toHaveBeenCalledWith(environment);
  expect(createApplication).toHaveBeenCalledWith(
    environment,
    expect.objectContaining(orderAccess),
  );
  expect(stop).toHaveBeenCalledTimes(1);
});
