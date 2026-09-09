import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  paymentGatewayWebhookConfigSchema,
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationResponseMatchesCommand,
} from "@fan-support/contracts";
import { createGatewayWebhookVerifier } from "./webhook.js";
import { connection, observedAt } from "./harness.gateway.js";
const key = Buffer.alloc(32, 19),
  oldKey = Buffer.alloc(32, 23);
const configuration = paymentGatewayWebhookConfigSchema.parse({
  schemaVersion: 1,
  binding: connection.binding,
  endpointId: "71000000-0000-4000-8000-000000000006",
  verificationKeyReferenceHash: "a".repeat(64),
  secretRef: "secret-ref:v1:payment:test/webhook",
  toleranceSeconds: 300,
  maxBodyBytes: 1048576,
});
const eventId = "evt_test_capture_1",
  timestamp = String(Date.parse(observedAt) / 1000);
const candidate = {
  schemaVersion: 1,
  providerEventId: eventId,
  occurredAt: observedAt,
  externalReference: "payment/test",
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  amountMinor: 2500,
  currency: "USD",
  transaction: { type: "CAPTURE", providerReference: "capture/test" },
};
const payload = () => ({
  schemaVersion: 1,
  protocol: "fan-support-gateway-v1",
  providerAccountId: connection.binding.providerAccountId,
  environment: "TEST",
  candidate,
});
const sign = (body: Buffer, id = eventId, ts = timestamp, secret = key) =>
  `v1,${createHmac("sha256", secret).update(`${id}.${ts}.`).update(body).digest("base64")}`;
function command(
  body = Buffer.from(JSON.stringify(payload())),
  id = eventId,
  ts = timestamp,
) {
  return paymentWebhookVerificationCommandSchema.parse({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId: configuration.endpointId,
    providerAccountId: connection.binding.providerAccountId,
    environment: "TEST",
    verificationKeyReferenceHash: configuration.verificationKeyReferenceHash,
    rawBodyBase64: body.toString("base64url"),
    receivedAt: observedAt,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sign(body, id, ts),
    },
  });
}
function setup(keys = [key]) {
  const resolve = vi.fn(async (input: unknown) => ({
    ...(input as object),
    version: "key-v2",
    values: keys.map((key) => `whsec_${key.toString("base64")}`),
  }));
  return {
    verifier: createGatewayWebhookVerifier({
      configuration,
      connection,
      credentials: { resolve },
    }),
    resolve,
  };
}
test("verifies raw Standard Webhooks bytes and returns an endpoint-bound candidate, without persistence", async () => {
  const input = command(Buffer.from(JSON.stringify(payload(), null, 2))),
    { verifier, resolve } = setup();
  const result = await verifier.verifyPaymentWebhook(input);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    value: {
      endpointId: configuration.endpointId,
      signatureTimestamp: observedAt,
      candidate,
    },
  });
  expect(paymentWebhookVerificationResponseMatchesCommand(input, result)).toBe(
    true,
  );
  expect(resolve).toHaveBeenCalledWith({
    schemaVersion: 1,
    secretRef: configuration.secretRef,
    providerAccountId: connection.binding.providerAccountId,
    environment: "TEST",
    purpose: "WEBHOOK_VERIFY",
  });
});
test("supports independent key and signature rotation, rejects unknown algorithms and body edits", async () => {
  const input = command(),
    raw = Buffer.from(input.rawBodyBase64, "base64url"),
    { verifier } = setup([oldKey, key]);
  input.headers["webhook-signature"] =
    `v1,${Buffer.alloc(32).toString("base64")} ${sign(raw, eventId, timestamp, oldKey)}`;
  expect(await verifier.verifyPaymentWebhook(input)).toMatchObject({
    outcome: "SUCCESS",
  });
  for (const patch of [
    { rawBodyBase64: Buffer.from(raw.toString() + " ").toString("base64url") },
    {
      headers: {
        ...input.headers,
        "webhook-signature": `v1a,${Buffer.alloc(64).toString("base64")}`,
      },
    },
    { headers: { ...input.headers, "webhook-id": "evt_other" } },
    {
      headers: {
        ...input.headers,
        "webhook-timestamp": String(Number(timestamp) + 1),
      },
    },
  ])
    expect(
      await verifier.verifyPaymentWebhook(
        paymentWebhookVerificationCommandSchema.parse({ ...input, ...patch }),
      ),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_SIGNATURE" },
    });
});
test("timestamp tolerance is bounded in both directions and permits delayed original events", async () => {
  const { verifier } = setup();
  for (const offset of [-301, 301])
    expect(
      await verifier.verifyPaymentWebhook(
        command(undefined, eventId, String(Number(timestamp) + offset)),
      ),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "EVENT_OUTSIDE_TOLERANCE" },
    });
  const body = Buffer.from(
    JSON.stringify({
      ...payload(),
      candidate: { ...candidate, occurredAt: "2025-01-01T00:00:00.000Z" },
    }),
  );
  expect(await verifier.verifyPaymentWebhook(command(body))).toMatchObject({
    outcome: "SUCCESS",
  });
});
test("foreign endpoint/account/keyhash fail before resolving; signed envelope and event identity must match", async () => {
  const { verifier, resolve } = setup(),
    input = command();
  for (const patch of [
    { endpointId: "71000000-0000-4000-8000-000000000099" },
    { environment: "LIVE" as const },
    { verificationKeyReferenceHash: "b".repeat(64) },
  ])
    expect(
      await verifier.verifyPaymentWebhook(
        paymentWebhookVerificationCommandSchema.parse({ ...input, ...patch }),
      ),
    ).toMatchObject({ outcome: "FAILURE", error: { code: "INVALID_COMMAND" } });
  expect(resolve).not.toHaveBeenCalled();
  for (const body of [
    { ...payload(), environment: "LIVE" },
    { ...payload(), providerAccountId: "71000000-0000-4000-8000-000000000099" },
    { ...payload(), candidate: { ...candidate, providerEventId: "other" } },
    { ...payload(), protocol: "stripe" },
    { ...payload(), extra: "PRIVATE_CANARY" },
  ])
    expect(
      await verifier.verifyPaymentWebhook(
        command(Buffer.from(JSON.stringify(body))),
      ),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "MALFORMED_PROVIDER_RESPONSE" },
    });
});
test("authenticates before parsing, enforces body limit and does not leak resolver or JSON details", async () => {
  const { verifier } = setup();
  const body = Buffer.from("PRIVATE_CANARY invalid JSON"),
    input = command(body);
  expect(
    await verifier.verifyPaymentWebhook({
      ...input,
      headers: { ...input.headers, "webhook-signature": "invalid" },
    }),
  ).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  expect(await verifier.verifyPaymentWebhook(input)).toMatchObject({
    error: { code: "MALFORMED_PROVIDER_RESPONSE" },
  });
  const bounded = createGatewayWebhookVerifier({
    configuration: { ...configuration, maxBodyBytes: 1024 },
    connection,
    credentials: { resolve: async () => null },
  });
  expect(
    await bounded.verifyPaymentWebhook(command(Buffer.alloc(1025))),
  ).toMatchObject({ outcome: "FAILURE", error: { code: "INVALID_COMMAND" } });
  const broken = createGatewayWebhookVerifier({
    configuration,
    connection,
    credentials: {
      resolve: async () => {
        throw new Error("PRIVATE_CANARY");
      },
    },
  });
  const result = await broken.verifyPaymentWebhook(command());
  expect(result).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
});
test("webhook construction cannot bypass unsupported stablecoin or mismatched connection binding", () => {
  const credentials = { resolve: async () => null };
  expect(() =>
    createGatewayWebhookVerifier({
      configuration: {
        ...configuration,
        binding: { ...configuration.binding, providerCode: "other" },
      },
      connection,
      credentials,
    }),
  ).toThrow();
});
test("matches the upstream Standard Webhooks fixed HMAC vector before rejecting its nonpayment JSON", async () => {
  // https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/webhook.test.ts
  const input = paymentWebhookVerificationCommandSchema.parse({
    ...command(),
    receivedAt: new Date(1614265330 * 1000).toISOString(),
    rawBodyBase64: Buffer.from('{"test": 2432232314}').toString("base64url"),
    headers: {
      "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "webhook-timestamp": "1614265330",
      "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    },
  });
  const { verifier } = setup([
    Buffer.from("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "base64"),
  ]);
  expect(await verifier.verifyPaymentWebhook(input)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "MALFORMED_PROVIDER_RESPONSE" },
  });
  expect(
    await verifier.verifyPaymentWebhook({
      ...input,
      rawBodyBase64: Buffer.from('{"test":2432232314}').toString("base64url"),
    }),
  ).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
});
