import { expect, test, vi } from "vitest";
import { createApiApplication } from "./bootstrap.js";

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const testDatabaseUrl = [
  "postgresql://",
  "test-user",
  ":",
  "test-password",
  "@postgres:5432/fan_support",
].join("");

const validEnvironment = Object.freeze({
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3002",
  FAN_SUPPORT_DATABASE_URL: testDatabaseUrl,
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

test("mounts all public directory routes through the real Nest bootstrap and closes their resource", async () => {
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const readIdols = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    catalogVersion: "a".repeat(64),
    items: [],
    pageInfo: {
      schemaVersion: 1 as const,
      hasNextPage: false,
      endCursor: null,
    },
  }));
  const readGifts = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "CATALOG_UNAVAILABLE" as const,
  }));
  const app = await createApiApplication(validEnvironment, {
    logger: quietLogger,
    catalogDirectoryRoute: { readIdols, readGifts, browseGifts: readGifts },
    catalogDirectoryRuntime: { start, stop },
  });
  try {
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    const idols = await server.inject({
      method: "GET",
      url: "/api/v1/idols?locale=zh-CN",
    });
    expect(idols.statusCode).toBe(200);
    expect(idols.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    expect(idols.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    const gifts = await server.inject({
      method: "GET",
      url: "/api/v1/gifts?locale=vi&market=TEST&currency=USD",
    });
    expect(gifts.statusCode).toBe(503);
    expect(gifts.headers["cache-control"]).toBe("no-store");
    expect(start).toHaveBeenCalledTimes(1);
    expect(readIdols).toHaveBeenCalledTimes(1);
    expect(readGifts).toHaveBeenCalledTimes(1);
    const browsing = await server.inject({
      method: "GET",
      url: "/api/v1/gift-browse?locale=vi",
    });
    expect(browsing.statusCode).toBe(503);
    expect(readGifts).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      locale: "vi",
      page: 1,
      pageSize: 12,
    });
  } finally {
    await app.close();
    expect(stop).toHaveBeenCalledTimes(1);
  }
});
