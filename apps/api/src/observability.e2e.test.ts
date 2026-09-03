import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { expect, test } from "vitest";

import { createApiApplication } from "./bootstrap.js";

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

test("correlates a safe request ID and W3C trace through Fastify", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = await createApiApplication(validEnvironment, {
    logger,
  });
  const requestId = "52a3f5cf-eb74-462b-9832-5ee86715c33b";
  const traceId = "2af7651916cd43dd8448eb211c80319c";

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
          traceparent: `00-${traceId}-b7ad6b7169203331-01`,
        },
      });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "api",
      event: "http.request.completed",
      requestId,
      traceId,
      httpMethod: "GET",
      httpRoute: "/healthz",
      httpStatusCode: 200,
      outcome: "success",
    });
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("replaces an invalid ID and keeps unmatched request data out of errors and logs", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = await createApiApplication(validEnvironment, {
    logger,
  });
  const emailCanary = ["private", "@example.invalid"].join("");
  const tokenCanary = ["ORDER", "_TOKEN", "_CANARY_31872"].join("");

  try {
    await application.init();
    const response = await application
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/missing/${emailCanary}?token=${tokenCanary}`,
        headers: {
          authorization: `Synthetic ${tokenCanary}`,
          cookie: `order=${tokenCanary}`,
          "x-request-id": `invalid-${emailCanary}`,
        },
      });

    expect(response.statusCode).toBe(404);
    const responseRequestId = response.headers["x-request-id"];
    expect(responseRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "NOT_FOUND",
      requestId: responseRequestId,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "api",
      event: "http.request.completed",
      requestId: responseRequestId,
      httpMethod: "GET",
      httpRoute: "/unmatched",
      httpStatusCode: 404,
      outcome: "success",
    });
    expect(lines.join("\n")).not.toContain(emailCanary);
    expect(lines.join("\n")).not.toContain(tokenCanary);
    expect(JSON.stringify(response.json())).not.toContain(emailCanary);
    expect(JSON.stringify(response.json())).not.toContain(tokenCanary);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});
