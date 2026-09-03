import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { expect, test } from "vitest";

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

test("correlates Worker HTTP requests without logging private headers", async () => {
  const telemetry = startNodeTelemetry({ service: "worker" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "worker",
    write: (line) => lines.push(line),
  });
  const application = await createWorkerApplication(validEnvironment, {
    logger,
  });
  const requestId = "bf1e1277-6401-4699-a1ef-68b1cf6838c1";
  const traceId = "3af7651916cd43dd8448eb211c80319c";
  const privateCanary = ["PRIVATE", "_MESSAGE", "_59281"].join("");

  try {
    await application.init();
    const response = await application
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/healthz",
        headers: {
          "x-request-id": requestId,
          traceparent: `00-${traceId}-c7ad6b7169203331-01`,
          authorization: privateCanary,
          cookie: privateCanary,
        },
      });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "worker",
      requestId,
      traceId,
      httpRoute: "/healthz",
      httpStatusCode: 200,
    });
    expect(lines[0]).not.toContain(privateCanary);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});
