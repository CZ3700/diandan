import { expect, test, vi } from "vitest";
import { createApiApplication } from "./bootstrap.js";
import type { CartEditRouteDependencies } from "./cart-edit-route.js";
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

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

test("bootstrap mounts all edits as unavailable when KMS is absent", async () => {
  const app = await createApiApplication(validEnvironment, {
    logger: quietLogger,
  });
  try {
    await app.init();
    for (const method of ["PATCH", "DELETE", "POST"] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/cart/items/10000000-0000-4000-8000-000000000001${method === "POST" ? "/editor" : ""}`,
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.json().code).toBe("TEMPORARY_UNAVAILABLE");
    }
  } finally {
    await app.close();
  }
});
test("bootstrap uses injected edit application and the same owned cart lifecycle", async () => {
  const execute = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "VERSION_CONFLICT",
  }));
  const stop = vi.fn(async () => undefined),
    start = vi.fn(async () => undefined);
  const credentials = {
    issue: vi.fn(),
    resolve: vi.fn(async () => ({
      accessCandidates: [
        {
          schemaVersion: 1,
          tokenDigest: "a".repeat(64),
          pepperVersion: "test-v1",
        },
      ],
      csrfToken: "A".repeat(43),
      csrfValid: true,
    })),
  } as CartEditRouteDependencies["credentials"];
  const app = await createApiApplication(validEnvironment, {
    logger: quietLogger,
    cartRuntime: { start, stop },
    cartEditRoute: {
      allowedOrigin: validEnvironment.FAN_SUPPORT_SITE_ORIGIN,
      credentials,
      useCases: { update: execute, remove: execute, readEditor: execute },
    },
  });
  try {
    await app.init();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/cart/items/10000000-0000-4000-8000-000000000001",
      headers: {
        origin: validEnvironment.FAN_SUPPORT_SITE_ORIGIN,
        cookie: "__Host-fan-cart=" + "A".repeat(43),
        "x-csrf-token": "A".repeat(43),
        "idempotency-key": "cart-bootstrap-edit-001",
        "content-type": "application/json",
      },
      payload: {
        schemaVersion: 1,
        expectedCartVersion: 2,
        expectedItemVersion: 1,
        presentationLocale: "en",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
  expect(stop).toHaveBeenCalledTimes(1);
});
