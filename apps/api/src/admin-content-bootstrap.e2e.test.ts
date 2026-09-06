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

test("mounts explicit admin content routes and closes their resources", async () => {
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const execute = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "FORBIDDEN" as const,
  }));
  const app = await createApiApplication(validEnvironment, {
    logger: quietLogger,
    adminContentRoute: {
      allowedOrigin: "http://localhost:3002",
      execute,
      readPreview: execute,
    },
    adminContentRuntime: { start, stop },
  });
  try {
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    const result = await server.inject({
      method: "POST",
      url: "/api/v1/admin/content/drafts/read",
      headers: {
        origin: "http://localhost:3002",
        "content-type": "application/json",
        cookie: "__Host-fan-admin-session=" + "A".repeat(43),
        "x-csrf-token": "A".repeat(43),
      },
      payload: {
        schemaVersion: 1,
        target: {
          schemaVersion: 1,
          kind: "IDOL_ALIASES",
          idolRevisionId: "10000000-0000-4000-8000-000000000001",
        },
      },
    });
    expect(result.statusCode).toBe(403);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
  expect(stop).toHaveBeenCalledTimes(1);
});
