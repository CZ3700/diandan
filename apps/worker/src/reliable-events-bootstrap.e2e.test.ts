import { expect, test, vi } from "vitest";

import { createWorkerApplication } from "./bootstrap.js";

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
  FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3003",
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

const quietLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

test("owns the reliable event runtime through Worker application lifecycle", async () => {
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const application = await createWorkerApplication(validEnvironment, {
    logger: quietLogger,
    reliableEventsRuntime: { start, stop },
  });

  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();

  await application.close();
  expect(stop).toHaveBeenCalledTimes(1);
});

test("fails Worker initialization when reliable events cannot start", async () => {
  const start = vi.fn(async () => {
    throw new Error("PRIVATE_QUEUE_START_FAILURE_85130");
  });
  const stop = vi.fn(async () => undefined);
  const application = await createWorkerApplication(validEnvironment, {
    logger: quietLogger,
    reliableEventsRuntime: { start, stop },
  });

  await application.init();
  await expect(
    application.getHttpAdapter().getInstance().ready(),
  ).rejects.toThrow("Worker reliable events failed to start");
  await application.close().catch(() => undefined);
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});
