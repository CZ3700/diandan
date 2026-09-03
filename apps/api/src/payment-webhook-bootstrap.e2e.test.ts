import { Buffer } from "node:buffer";

import { receivePaymentWebhookResponseSchema } from "@fan-support/contracts";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { expect, test, vi } from "vitest";

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

const quietLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

test("mounts the payment webhook route in the real API composition root", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const endpointId = "10000000-0000-4000-8000-000000000001";
  const body = Buffer.from('{"provider":"fixture"}\n', "utf8");
  const endpointPreflight = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "ELIGIBLE" as const,
  }));
  const receive = vi.fn(async () =>
    receivePaymentWebhookResponseSchema.parse({
      schemaVersion: 1,
      operation: "RECEIVE_PAYMENT_WEBHOOK",
      outcome: "SUCCESS",
      value: {
        decision: "ACCEPTED_NEW",
        webhookInboxId: "20000000-0000-4000-8000-000000000001",
        providerEventRowId: "30000000-0000-4000-8000-000000000001",
      },
    }),
  );
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const application = await createApiApplication(validEnvironment, {
    logger: quietLogger,
    reliableEventsRuntime: { start, stop },
    paymentWebhookRoute: {
      endpointPreflight,
      receiver: { receive },
      now: () => new Date("2026-09-04T03:00:00.000Z"),
      createCorrelationId: () => "40000000-0000-4000-8000-000000000001",
    },
  });

  try {
    await application.init();
    const response = await application
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/api/v1/webhooks/payments/${endpointId}`,
        headers: {
          "content-type": "application/json",
          "x-fan-support-signature": `v1=${"a".repeat(64)}`,
          "x-fan-support-timestamp": "1788480000",
        },
        payload: body,
      });

    expect(response.statusCode).toBe(202);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(endpointPreflight).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId,
        rawBodyBase64: body.toString("base64url"),
      }),
    );
  } finally {
    await application.close();
    expect(stop).toHaveBeenCalledTimes(1);
    await telemetry.shutdown();
  }
});
