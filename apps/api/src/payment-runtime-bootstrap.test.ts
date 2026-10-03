import { expect, test, vi } from "vitest";
import { createApiApplication } from "./bootstrap.js";
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

test("unconfigured payment routes remain private typed failures before reading caller input", async () => {
  const app = await createApiApplication(environment, { logger });
  try {
    await app.init();
    const id = "10000000-0000-4000-8000-000000000001";
    for (const [method, url] of [
      ["GET", "/api/v1/checkout/current/status"],
      ["GET", `/api/v1/checkout/sessions/${id}/capabilities`],
      ["POST", `/api/v1/checkout/sessions/${id}/attempts`],
      ["GET", `/api/v1/checkout/sessions/${id}/attempts/${id}`],
      ["POST", `/api/v1/checkout/sessions/${id}/attempts/${id}/recover`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      });
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  } finally {
    await app.close();
  }
});
