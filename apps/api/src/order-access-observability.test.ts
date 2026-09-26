import { Buffer } from "node:buffer";
import {
  orderAccessConfigurationSchema,
  type ComputeBlindIndexCommand,
} from "@fan-support/contracts";
import { createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test, vi } from "vitest";
import { createApiApplication } from "./bootstrap.js";
import { createOrderAccessCredentials } from "./order-access-credentials.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";

const origin = "https://shop.example.invalid";
const environment = {
  NODE_ENV: "test",
  FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  FAN_SUPPORT_SITE_ORIGIN: origin,
  FAN_SUPPORT_DATABASE_URL: "postgresql://test.invalid/orders",
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
async function setup() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const keyManagement = {
    async computeBlindIndex(command: ComputeBlindIndexCommand) {
      return {
        schemaVersion: 1 as const,
        operation: "COMPUTE_BLIND_INDEX" as const,
        outcome: "SUCCESS" as const,
        value: {
          algorithm: "HMAC_SHA_256" as const,
          keyVersion: command.keyVersion!,
          digestBase64: createHmac("sha256", "TEST_ORDER_OBSERVABILITY")
            .update(command.purpose)
            .update(command.valueBase64)
            .digest("base64url"),
        },
      };
    },
  };
  const config = {
    activePepperVersion: "test-v1",
    pepperVersions: ["test-v1"],
    keyManagement,
  };
  const credentials = createOrderAccessCredentials(config);
  const business = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "ACCESS_DENIED",
  }));
  const rate = vi.fn(async () => ({
    schemaVersion: 1,
    allowed: true,
    retryAfterSeconds: 0,
  }));
  const app = await createApiApplication(environment, {
    logger,
    orderAccessRoute: {
      configuration: orderAccessConfigurationSchema.parse({
        schemaVersion: 1,
        publicStorefrontOrigin: origin,
        sessionTtlSeconds: 900,
        linkTtlSeconds: 3600,
        rateLimit: {
          windowSeconds: 60,
          exchangeMax: 10,
          bootstrapMax: 10,
          readMax: 10,
          revokeMax: 10,
        },
      }),
      credentials,
      cartCredentials: createCartSessionCredentials(config),
      useCases: {
        exchange: business,
        bootstrap: business,
        read: business,
        revoke: business,
        locate: business,
        consumeRateLimit: rate,
      },
    },
  });
  await app.init();
  return { app, logger, business, credentials };
}

test("real API observability records only route templates and never exchange bodies or credential headers", async () => {
  const { app, logger, business } = await setup();
  const token = randomBytes(32).toString("base64url"),
    cookie = randomBytes(32).toString("base64url");
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/order-access/exchange",
      headers: {
        origin,
        cookie: `__Host-fan-order=${cookie}`,
        "content-type": "application/json",
      },
      payload: { schemaVersion: 1, token },
    });
    expect(response.statusCode).toBe(401);
    expect(business).toHaveBeenCalledTimes(1);
    const recorded = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(recorded).toContain("/api/v1/order-access/exchange");
    for (const secret of [token, cookie])
      expect(recorded).not.toContain(secret);
    expect(recorded).not.toContain("__Host-fan-order");
    expect(response.body).not.toContain(token);
  } finally {
    await app.close();
  }
});

test("actual HTTP duplicate Origin, Cookie and CSRF headers cannot dispatch an order operation", async () => {
  const { app, business, credentials } = await setup();
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    const session = await credentials.issueSession();
    async function send(extra: string[], path = "/api/v1/order-access/revoke") {
      const payload = JSON.stringify({
        schemaVersion: 1,
        publicOrderId: "10000000-0000-4000-8000-000000000001",
      });
      return new Promise<{
        status: number;
        body: string;
        headers: Record<string, string | string[] | undefined>;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            method: "POST",
            path,
            headers: [
              "Host",
              `127.0.0.1:${address.port}`,
              "Origin",
              origin,
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(payload)),
              "Cookie",
              `__Host-fan-order=${session.token}`,
              "X-CSRF-Token",
              session.csrfToken,
              ...extra,
            ],
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () =>
              resolve({
                status: response.statusCode!,
                body,
                headers: response.headers,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end(payload);
      });
    }
    for (const extra of [
      ["Origin", origin],
      ["Cookie", `__Host-fan-order=${session.token}`],
      ["X-CSRF-Token", session.csrfToken],
    ]) {
      const result = await send(extra);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.body).not.toContain(session.token);
    }
    expect(business).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
