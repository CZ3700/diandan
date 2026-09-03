import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { expect, test } from "vitest";

import {
  paymentWebhookVerificationResponseMatchesCommand,
  type PaymentWebhookVerificationCommand,
  type PaymentWebhookVerifier,
} from "@fan-support/payment-port";
import { loadReviewedProviderFixtureBundle } from "@fan-support/testing";

import * as paymentFake from "./index.js";

const endpointId = "10000000-0000-4000-8000-000000000011";
const providerAccountId = "10000000-0000-4000-8000-000000000012";
const keyReferenceHash = "a".repeat(64);
const secret = Buffer.from("fixture-webhook-secret-32-bytes!!", "utf8");
const receivedAt = "2026-09-04T00:00:00.000Z";
const signatureTimestamp = "1788480000";

const providerEvent = {
  event_id: "fake-event-1",
  created_at: "2026-09-03T23:59:59.000Z",
  resource: {
    kind: "payment",
    payment_reference: "fake-payment/fixture-attempt-1",
    state: "captured",
    amount_minor: 2_500,
    currency: "USD",
    transaction: {
      kind: "capture",
      reference: "fake-capture-1",
    },
  },
} as const;

type FakeVerifierFactory = (options: {
  endpointId: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  verificationKeyReferenceHash: string;
  verificationSecret: Uint8Array;
}) => PaymentWebhookVerifier;

function factory(): FakeVerifierFactory {
  const candidate = (paymentFake as Record<string, unknown>)[
    "createFakePaymentWebhookVerifier"
  ];
  expect(candidate).toBeTypeOf("function");
  return candidate as FakeVerifierFactory;
}

function verifier(environment: "TEST" | "LIVE" = "TEST") {
  return factory()({
    endpointId,
    providerAccountId,
    environment,
    verificationKeyReferenceHash: keyReferenceHash,
    verificationSecret: secret,
  });
}

function rawBody(value: unknown = providerEvent): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function signature(bytes: Uint8Array, timestamp = signatureTimestamp): string {
  return `v1=${createHmac("sha256", secret)
    .update(timestamp, "utf8")
    .update(".", "utf8")
    .update(bytes)
    .digest("hex")}`;
}

function command(
  bytes: Uint8Array = rawBody(),
  overrides: Partial<PaymentWebhookVerificationCommand> = {},
): PaymentWebhookVerificationCommand {
  return {
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId,
    providerAccountId,
    environment: "TEST",
    verificationKeyReferenceHash: keyReferenceHash,
    rawBodyBase64: Buffer.from(bytes).toString("base64url"),
    headers: {
      "x-fan-support-signature": signature(bytes),
      "x-fan-support-timestamp": signatureTimestamp,
    },
    receivedAt,
    ...overrides,
  } as PaymentWebhookVerificationCommand;
}

test("verifies exact raw bytes and returns a persistence-free candidate", async () => {
  const input = command();
  const snapshot = JSON.stringify(input);
  const response = await verifier().verifyPaymentWebhook(input);

  expect(response).toEqual({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    outcome: "SUCCESS",
    value: {
      endpointId,
      providerAccountId,
      environment: "TEST",
      verificationKeyReferenceHash: keyReferenceHash,
      signatureTimestamp: receivedAt,
      candidate: {
        schemaVersion: 1,
        providerEventId: "fake-event-1",
        occurredAt: providerEvent.created_at,
        externalReference: providerEvent.resource.payment_reference,
        eventType: "PAYMENT_STATUS",
        status: "SUCCEEDED",
        amountMinor: 2_500,
        currency: "USD",
        transaction: {
          type: "CAPTURE",
          providerReference: "fake-capture-1",
        },
      },
    },
  });
  expect(
    paymentWebhookVerificationResponseMatchesCommand(input, response),
  ).toBe(true);
  expect(JSON.stringify(input)).toBe(snapshot);
  expect(JSON.stringify(response)).not.toContain(secret.toString("utf8"));
  expect(JSON.stringify(response)).not.toContain("x-fan-support-signature");
});

test("authenticates before parsing provider JSON", async () => {
  const malformed = Buffer.from("{not-json", "utf8");
  const invalidSignature = command(malformed, {
    headers: {
      "x-fan-support-signature": `v1=${"0".repeat(64)}`,
      "x-fan-support-timestamp": signatureTimestamp,
    },
  });
  const validSignature = command(malformed);

  await expect(
    verifier().verifyPaymentWebhook(invalidSignature),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "INVALID_SIGNATURE", recovery: "NONE" },
  });
  await expect(
    verifier().verifyPaymentWebhook(validSignature),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "MALFORMED_PROVIDER_RESPONSE", recovery: "NONE" },
  });
});

test("rejects byte-level tampering and JSON whitespace changes", async () => {
  const original = rawBody();
  const changedWhitespace = Buffer.from(
    JSON.stringify(providerEvent, null, 2),
    "utf8",
  );
  const originalSignature = signature(original);

  for (const bytes of [
    Buffer.concat([original, Buffer.from(" ")]),
    changedWhitespace,
  ]) {
    await expect(
      verifier().verifyPaymentWebhook(
        command(bytes, {
          headers: {
            "x-fan-support-signature": originalSignature,
            "x-fan-support-timestamp": signatureTimestamp,
          },
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_SIGNATURE" },
    });
  }
});

test("rejects expired and future signatures only after they authenticate", async () => {
  const bytes = rawBody();
  for (const timestamp of ["1788479399", "1788480301"]) {
    await expect(
      verifier().verifyPaymentWebhook(
        command(bytes, {
          headers: {
            "x-fan-support-signature": signature(bytes, timestamp),
            "x-fan-support-timestamp": timestamp,
          },
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "EVENT_OUTSIDE_TOLERANCE", recovery: "NONE" },
    });
  }
});

test("fails closed for LIVE and mismatched endpoint identity", async () => {
  const input = command();
  await expect(
    verifier("LIVE").verifyPaymentWebhook({ ...input, environment: "LIVE" }),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });

  for (const mismatch of [
    { endpointId: "10000000-0000-4000-8000-000000000021" },
    { providerAccountId: "10000000-0000-4000-8000-000000000022" },
    { verificationKeyReferenceHash: "b".repeat(64) },
  ]) {
    await expect(
      verifier().verifyPaymentWebhook({
        ...input,
        ...mismatch,
      } as PaymentWebhookVerificationCommand),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
  }
});

test("does not confuse a signature made with another secret for a parse error", async () => {
  const bytes = rawBody();
  const wrongSecretSignature = `v1=${createHmac(
    "sha256",
    Buffer.from("another-fixture-secret-32-bytes!", "utf8"),
  )
    .update(signatureTimestamp, "utf8")
    .update(".", "utf8")
    .update(bytes)
    .digest("hex")}`;

  await expect(
    verifier().verifyPaymentWebhook(
      command(bytes, {
        headers: {
          "x-fan-support-signature": wrongSecretSignature,
          "x-fan-support-timestamp": signatureTimestamp,
        },
      }),
    ),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "INVALID_SIGNATURE", recovery: "NONE" },
  });
});

test("matches the reviewed duplicate and out-of-order webhook fixture", async () => {
  const bundle = await loadReviewedProviderFixtureBundle();
  const fixture = bundle.fixtures["payment-webhook-fake.v1.json"];
  const fakeVerifier = verifier();

  for (const delivery of fixture.deliveries) {
    const bytes = Buffer.from(delivery.rawBody, "utf8");
    const response = await fakeVerifier.verifyPaymentWebhook(command(bytes));
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: { candidate: delivery.expected },
    });
  }

  const duplicateBytes = Buffer.from(fixture.deliveries[0].rawBody, "utf8");
  const duplicateResponses = await Promise.all(
    Array.from({ length: fixture.repeatCount }, () =>
      fakeVerifier.verifyPaymentWebhook(command(duplicateBytes)),
    ),
  );
  expect(
    new Set(duplicateResponses.map((response) => JSON.stringify(response))),
  ).toHaveLength(1);
});
