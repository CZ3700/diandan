import { Buffer } from "node:buffer";

import { expect, test } from "vitest";
import { z } from "zod";

import * as contracts from "./index.js";

type SchemaLike = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

type JsonObject = Record<string, unknown>;

const contractExports = contracts as Record<string, unknown>;

function schema(name: string): SchemaLike {
  const candidate = contractExports[name] as SchemaLike | undefined;
  expect(candidate, `${name} must be exported`).toBeDefined();
  return candidate as SchemaLike;
}

const endpointId = "10000000-0000-4000-8000-000000000011";
const providerAccountId = "10000000-0000-4000-8000-000000000012";
const webhookInboxId = "10000000-0000-4000-8000-000000000013";
const outboxEventId = "10000000-0000-4000-8000-000000000014";
const keyReferenceHash = "a".repeat(64);

const verifierCommand = {
  schemaVersion: 1,
  operation: "VERIFY_PAYMENT_WEBHOOK",
  endpointId,
  providerAccountId,
  environment: "TEST",
  verificationKeyReferenceHash: keyReferenceHash,
  rawBodyBase64: "e30",
  headers: { "x-fake-signature": "fixture-signature" },
  receivedAt: "2026-09-04T00:00:00.000Z",
} as const;

const receiveCommand = {
  schemaVersion: 1,
  operation: "RECEIVE_PAYMENT_WEBHOOK",
  endpointId,
  rawBodyBase64: "e30",
  headers: { "x-fake-signature": "fixture-signature" },
  receivedAt: "2026-09-04T00:00:00.000Z",
  correlationId: "10000000-0000-4000-8000-000000000017",
  propagation: {
    schemaVersion: 1,
    requestId: "10000000-0000-4000-8000-000000000016",
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  },
} as const;

test("defines strict versioned endpoint preflight command and result contracts", () => {
  const commandSchema = schema("paymentWebhookEndpointPreflightCommandSchema");
  const resultSchema = schema("paymentWebhookEndpointPreflightResultSchema");
  const command = {
    schemaVersion: 1,
    endpointId,
    receivedAt: "2026-09-04T00:00:00.000Z",
  } as const;

  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(
    commandSchema.safeParse({ ...command, unexpected: "field" }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({ ...command, schemaVersion: 2 }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      endpointId: "A0000000-0000-4000-8000-000000000011",
    }).success,
  ).toBe(false);

  for (const outcome of [
    "ELIGIBLE",
    "UNAVAILABLE",
    "INVALID_REQUEST",
    "TEMPORARY_UNAVAILABLE",
  ]) {
    expect(resultSchema.safeParse({ schemaVersion: 1, outcome }).success).toBe(
      true,
    );
  }
  expect(
    resultSchema.safeParse({
      schemaVersion: 1,
      outcome: "ELIGIBLE",
      endpointId,
    }).success,
  ).toBe(false);
});

const verifierResponse = {
  schemaVersion: 1,
  operation: "VERIFY_PAYMENT_WEBHOOK",
  outcome: "SUCCESS",
  value: {
    endpointId,
    providerAccountId,
    environment: "TEST",
    verificationKeyReferenceHash: keyReferenceHash,
    signatureTimestamp: "2026-09-04T00:00:00.000Z",
    candidate: {
      schemaVersion: 1,
      providerEventId: "fixture-event-1",
      occurredAt: "2026-09-03T23:59:59.000Z",
      externalReference: "fixture-payment-1",
      eventType: "PAYMENT_STATUS",
      status: "SUCCEEDED",
      amountMinor: 2_500,
      currency: "USD",
      transaction: {
        type: "CAPTURE",
        providerReference: "fixture-capture-1",
      },
    },
  },
} as const;

test("defines an endpoint-scoped verifier that returns only a normalized candidate", () => {
  const commandSchema = schema("paymentWebhookVerificationCommandSchema");
  const responseSchema = schema("paymentWebhookVerificationResponseSchema");
  const matcher =
    contractExports["paymentWebhookVerificationResponseMatchesCommand"];

  expect(commandSchema.safeParse(verifierCommand).success).toBe(true);
  expect(responseSchema.safeParse(verifierResponse).success).toBe(true);
  expect(matcher).toBeTypeOf("function");
  expect(
    (matcher as (command: unknown, response: unknown) => boolean)(
      verifierCommand,
      verifierResponse,
    ),
  ).toBe(true);

  expect(
    responseSchema.safeParse({
      ...verifierResponse,
      value: {
        ...verifierResponse.value,
        candidate: {
          ...verifierResponse.value.candidate,
          evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId },
          association: {
            status: "MATCHED",
            paymentAttemptId: "10000000-0000-4000-8000-000000000015",
            externalReference: "fixture-payment-1",
          },
        },
      },
    }).success,
  ).toBe(false);
});

test("defines one strict route-to-application webhook ingress command", () => {
  const commandSchema = schema("receivePaymentWebhookCommandSchema");
  const responseSchema = schema("receivePaymentWebhookResponseSchema");

  expect(commandSchema.safeParse(receiveCommand).success).toBe(true);
  for (const forbidden of [
    { providerAccountId },
    { environment: "TEST" },
    { verificationSecret: "do-not-cross-the-route" },
    { webhookInboxId },
  ]) {
    expect(
      commandSchema.safeParse({ ...receiveCommand, ...forbidden }).success,
    ).toBe(false);
  }
  expect(
    commandSchema.safeParse({ ...receiveCommand, schemaVersion: 2 }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...receiveCommand,
      headers: { authorization: "Bearer secret" },
    }).success,
  ).toBe(false);

  for (const decision of ["ACCEPTED_NEW", "ACCEPTED_REPLAY"] as const) {
    expect(
      responseSchema.safeParse({
        schemaVersion: 1,
        operation: receiveCommand.operation,
        outcome: "SUCCESS",
        value: {
          decision,
          webhookInboxId,
          providerEventRowId: "10000000-0000-4000-8000-000000000018",
        },
      }).success,
    ).toBe(true);
  }

  for (const code of [
    "INVALID_REQUEST",
    "ENDPOINT_UNAVAILABLE",
    "INVALID_SIGNATURE",
    "EVENT_OUTSIDE_TOLERANCE",
    "UNSUPPORTED_EVENT",
    "IDEMPOTENCY_CONFLICT",
    "CONFIGURATION_ERROR",
  ]) {
    expect(
      responseSchema.safeParse({
        schemaVersion: 1,
        operation: receiveCommand.operation,
        outcome: "FAILURE",
        error: { schemaVersion: 1, code, recovery: "NONE" },
      }).success,
    ).toBe(true);
  }
  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: receiveCommand.operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    }).success,
  ).toBe(true);
  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: receiveCommand.operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_SIGNATURE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    }).success,
  ).toBe(false);
});

test("defines a strict public webhook accepted response without internal receipt data", () => {
  const acceptedSchema = schema("paymentWebhookAcceptedResponseSchema");
  const accepted = { schemaVersion: 1, status: "accepted" } as const;

  expect(acceptedSchema.safeParse(accepted).success).toBe(true);
  for (const invalid of [
    { ...accepted, schemaVersion: 2 },
    { ...accepted, status: "processed" },
    { ...accepted, webhookInboxId },
    { ...accepted, providerAccountId },
    { ...accepted, rawBodyBase64: "e30" },
  ]) {
    expect(acceptedSchema.safeParse(invalid).success).toBe(false);
  }
});

test("binds verifier success to the endpoint, account, environment, key and time window", () => {
  const matcher = contractExports[
    "paymentWebhookVerificationResponseMatchesCommand"
  ] as (command: unknown, response: unknown) => boolean;

  for (const value of [
    { ...verifierResponse.value, endpointId: outboxEventId },
    { ...verifierResponse.value, providerAccountId: outboxEventId },
    { ...verifierResponse.value, environment: "LIVE" },
    {
      ...verifierResponse.value,
      verificationKeyReferenceHash: "b".repeat(64),
    },
    {
      ...verifierResponse.value,
      signatureTimestamp: "2026-09-03T23:49:59.999Z",
    },
    {
      ...verifierResponse.value,
      signatureTimestamp: "2026-09-04T00:05:00.001Z",
    },
  ]) {
    expect(matcher(verifierCommand, { ...verifierResponse, value })).toBe(
      false,
    );
  }
});

test("keeps verifier commands free of secret values and persistence decisions", () => {
  const commandSchema = schema("paymentWebhookVerificationCommandSchema");

  for (const forbidden of [
    { verificationSecret: "do-not-cross-the-port" },
    { verificationSecretRef: "secret/provider/webhook" },
    { webhookInboxId },
  ]) {
    expect(
      commandSchema.safeParse({ ...verifierCommand, ...forbidden }).success,
    ).toBe(false);
  }
});

test("bounds exact webhook bytes, headers and key identity", () => {
  const commandSchema = schema("paymentWebhookVerificationCommandSchema");
  const atLimit = Buffer.alloc(49_152, 0x61).toString("base64url");
  const overLimit = Buffer.alloc(49_153, 0x61).toString("base64url");

  expect(
    commandSchema.safeParse({ ...verifierCommand, rawBodyBase64: atLimit })
      .success,
  ).toBe(true);
  for (const invalid of [
    { ...verifierCommand, rawBodyBase64: overLimit },
    {
      ...verifierCommand,
      verificationKeyReferenceHash: keyReferenceHash.toUpperCase(),
    },
    {
      ...verifierCommand,
      verificationKeyReferenceHash: keyReferenceHash.slice(1),
    },
    { ...verifierCommand, headers: { "X-Fake-Signature": "value" } },
    { ...verifierCommand, headers: { authorization: "Bearer secret" } },
    { ...verifierCommand, headers: { cookie: "session=secret" } },
    {
      ...verifierCommand,
      headers: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [
          `x-large-${index}`,
          "v".repeat(8_192),
        ]),
      ),
    },
  ]) {
    expect(commandSchema.safeParse(invalid).success).toBe(false);
  }
});

test("publishes executable JSON Schema parity for safe webhook headers", () => {
  const headersSchema = contractExports[
    "paymentWebhookHeadersSchema"
  ] as z.ZodType;
  const jsonSchema = z.toJSONSchema(headersSchema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
  }) as JsonObject;
  const propertyNames = jsonSchema["propertyNames"] as JsonObject;
  const headerValues = jsonSchema["additionalProperties"] as JsonObject;
  const forbiddenCredentialNames = [
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
  ];

  expect(jsonSchema["maxProperties"]).toBe(64);
  expect(propertyNames["not"]).toEqual({
    enum: forbiddenCredentialNames,
  });
  expect(headerValues["pattern"]).toBe("^[^\\u0000-\\u001F\\u007F]*$");
  expect(jsonSchema["x-runtime-invariants"]).toEqual([
    "sum(utf8ByteLength(name) + utf8ByteLength(value) + 4) across all headers must be <= 32768 bytes",
  ]);

  const maximumFieldCount = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`x-${index}`, "v"]),
  );
  expect(headersSchema.safeParse(maximumFieldCount).success).toBe(true);
  expect(
    headersSchema.safeParse({ ...maximumFieldCount, "x-over-limit": "v" })
      .success,
  ).toBe(false);

  for (const name of forbiddenCredentialNames) {
    expect(headersSchema.safeParse({ [name]: "secret" }).success).toBe(false);
  }
  for (const value of ["nul\u0000", "unit-separator\u001f", "delete\u007f"]) {
    expect(headersSchema.safeParse({ "x-test": value }).success).toBe(false);
  }

  const headersAtByteLimit = {
    "x-0": "v".repeat(8_192),
    "x-1": "v".repeat(8_192),
    "x-2": "v".repeat(8_192),
    "x-3": "v".repeat(8_164),
  };
  expect(headersSchema.safeParse(headersAtByteLimit).success).toBe(true);
  expect(
    headersSchema.safeParse({
      ...headersAtByteLimit,
      "x-3": `${headersAtByteLimit["x-3"]}v`,
    }).success,
  ).toBe(false);
});

test("rejects provider DTO leakage and impossible normalized transactions", () => {
  const candidateSchema = schema("verifiedWebhookEventCandidateSchema");
  const candidate = verifierResponse.value.candidate;

  for (const forbidden of [
    { providerAccountId },
    { environment: "TEST" },
    { evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId } },
    { association: { status: "UNMATCHED" } },
    { rawBodyBase64: "e30" },
    { headers: { "x-fake-signature": "secret" } },
    { metadata: { provider: "object" } },
    { providerStatus: "captured" },
  ]) {
    expect(
      candidateSchema.safeParse({ ...candidate, ...forbidden }).success,
    ).toBe(false);
  }
  expect(
    candidateSchema.safeParse({
      ...candidate,
      status: "FAILED",
      transaction: {
        type: "CAPTURE",
        providerReference: "fixture-capture-1",
      },
    }).success,
  ).toBe(false);
  expect(
    candidateSchema.safeParse({ ...candidate, schemaVersion: 2 }).success,
  ).toBe(false);
});

test("accepts the inclusive database signature-time boundaries", () => {
  const matcher = contractExports[
    "paymentWebhookVerificationResponseMatchesCommand"
  ] as (command: unknown, response: unknown) => boolean;

  for (const signatureTimestamp of [
    "2026-09-03T23:50:00.000Z",
    "2026-09-04T00:05:00.000Z",
  ]) {
    expect(
      matcher(verifierCommand, {
        ...verifierResponse,
        value: { ...verifierResponse.value, signatureTimestamp },
      }),
    ).toBe(true);
  }
});

test("defines strict ID-only queue envelopes with safe propagation context", () => {
  const inboxJobSchema = schema("webhookInboxJobSchema");
  const outboxJobSchema = schema("outboxDispatchJobSchema");
  const jobSchema = schema("reliableEventJobSchema");
  const propagation = {
    schemaVersion: 1,
    requestId: "10000000-0000-4000-8000-000000000016",
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  };
  const inboxJob = {
    schemaVersion: 1,
    jobType: "PROCESS_WEBHOOK_INBOX",
    webhookInboxId,
    correlationId: "10000000-0000-4000-8000-000000000017",
    propagation,
  };
  const outboxJob = {
    schemaVersion: 1,
    jobType: "DISPATCH_OUTBOX_EVENT",
    outboxEventId,
    consumerKey: "notification-provider",
    correlationId: "10000000-0000-4000-8000-000000000017",
    propagation,
  };

  expect(inboxJobSchema.safeParse(inboxJob).success).toBe(true);
  expect(outboxJobSchema.safeParse(outboxJob).success).toBe(true);
  expect(jobSchema.safeParse(inboxJob).success).toBe(true);
  expect(jobSchema.safeParse(outboxJob).success).toBe(true);

  for (const forbidden of [
    { rawBodyBase64: "e30" },
    { headers: { authorization: "secret" } },
    { verificationSecret: "secret" },
    { providerEvent: verifierResponse.value.candidate },
  ]) {
    expect(
      inboxJobSchema.safeParse({ ...inboxJob, ...forbidden }).success,
    ).toBe(false);
  }
  expect(jobSchema.safeParse({ ...inboxJob, schemaVersion: 2 }).success).toBe(
    false,
  );
  expect(
    jobSchema.safeParse({
      ...inboxJob,
      propagation: { ...propagation, schemaVersion: 2 },
    }).success,
  ).toBe(false);
  expect(
    jobSchema.safeParse({
      ...inboxJob,
      propagation: { ...propagation, baggage: "private=value" },
    }).success,
  ).toBe(false);
});

test("normalizes queue delivery attempts without exposing queue internals", () => {
  const deliveryContextSchema = schema("reliableEventDeliveryContextSchema");
  const context = {
    schemaVersion: 1,
    jobId: "10000000-0000-4000-8000-000000000019",
    attemptNumber: 2,
    maxAttempts: 6,
  };

  expect(deliveryContextSchema.safeParse(context).success).toBe(true);
  expect(
    deliveryContextSchema.safeParse({ ...context, attemptNumber: 7 }).success,
  ).toBe(false);
  expect(
    deliveryContextSchema.safeParse({ ...context, maxAttempts: 7 }).success,
  ).toBe(false);
  expect(
    deliveryContextSchema.safeParse({ ...context, retryCount: 1 }).success,
  ).toBe(false);
});
