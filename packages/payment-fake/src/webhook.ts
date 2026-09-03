import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import { z } from "zod";

import {
  paymentWebhookEndpointIdSchema,
  providerAccountIdSchema,
  verificationKeyReferenceHashSchema,
  verifiedWebhookEventCandidateSchema,
} from "@fan-support/contracts";
import {
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationResponseSchema,
  type PaymentWebhookVerificationCommand,
  type PaymentWebhookVerificationResponse,
  type PaymentWebhookVerifier,
  type VerifiedWebhookEventCandidate,
} from "@fan-support/payment-port";

const SIGNATURE_HEADER = "x-fan-support-signature";
const TIMESTAMP_HEADER = "x-fan-support-timestamp";
const MAX_PAST_SKEW_MS = 10 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const optionsSchema = z.strictObject({
  endpointId: paymentWebhookEndpointIdSchema,
  providerAccountId: providerAccountIdSchema,
  environment: z.enum(["TEST", "LIVE"]),
  verificationKeyReferenceHash: verificationKeyReferenceHashSchema,
  verificationSecret: z
    .instanceof(Uint8Array)
    .refine((secret) => secret.byteLength >= 32 && secret.byteLength <= 4_096),
});

const transactionSchema = z.strictObject({
  kind: z.enum(["authorization", "capture", "void", "refund", "chargeback"]),
  reference: z.string().min(1).max(256),
});

const amountShape = {
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3),
} as const;

const providerWebhookSchema = z.strictObject({
  event_id: z.string().min(1).max(256),
  created_at: z.iso.datetime({ offset: true }),
  resource: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("payment"),
      payment_reference: z.string().min(1).max(256),
      state: z.enum([
        "created",
        "requires_action",
        "processing",
        "captured",
        "failed",
        "canceled",
        "expired",
        "unknown",
      ]),
      ...amountShape,
      transaction: transactionSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("refund"),
      payment_reference: z.string().min(1).max(256),
      refund_reference: z.string().min(1).max(256),
      state: z.enum([
        "requested",
        "submitting",
        "processing",
        "succeeded",
        "failed",
        "unknown",
      ]),
      ...amountShape,
      transaction: transactionSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("dispute"),
      payment_reference: z.string().min(1).max(256),
      dispute_reference: z.string().min(1).max(256),
      state: z.enum(["open", "won", "lost"]),
      ...amountShape,
      transaction: transactionSchema.optional(),
    }),
  ]),
});

export type FakePaymentWebhookVerifierOptions = Readonly<{
  endpointId: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  verificationKeyReferenceHash: string;
  verificationSecret: Uint8Array;
}>;

type VerificationFailureCode =
  | "INVALID_COMMAND"
  | "INVALID_SIGNATURE"
  | "EVENT_OUTSIDE_TOLERANCE"
  | "UNSUPPORTED_EVENT"
  | "CONFIGURATION_ERROR"
  | "MALFORMED_PROVIDER_RESPONSE";

function failure(
  code: VerificationFailureCode,
): PaymentWebhookVerificationResponse {
  return paymentWebhookVerificationResponseSchema.parse({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupportedResourceKind(value: unknown): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value["resource"])) {
    return false;
  }
  const kind = value["resource"]["kind"];
  return (
    typeof kind === "string" && !["payment", "refund", "dispute"].includes(kind)
  );
}

function normalizedTransaction(
  transaction: z.infer<typeof transactionSchema> | undefined,
):
  | Readonly<{
      type: "AUTHORIZATION" | "CAPTURE" | "VOID" | "REFUND" | "CHARGEBACK";
      providerReference: string;
    }>
  | undefined {
  if (transaction === undefined) {
    return undefined;
  }
  const transactionTypes = {
    authorization: "AUTHORIZATION",
    capture: "CAPTURE",
    void: "VOID",
    refund: "REFUND",
    chargeback: "CHARGEBACK",
  } as const;
  return {
    type: transactionTypes[transaction.kind],
    providerReference: transaction.reference,
  };
}

function normalizeProviderWebhook(
  value: z.infer<typeof providerWebhookSchema>,
): VerifiedWebhookEventCandidate | undefined {
  const resource = value.resource;
  const base = {
    schemaVersion: 1,
    providerEventId: value.event_id,
    occurredAt: value.created_at,
    externalReference: resource.payment_reference,
    amountMinor: resource.amount_minor,
    currency: resource.currency.toUpperCase(),
    ...(resource.transaction === undefined
      ? {}
      : { transaction: normalizedTransaction(resource.transaction) }),
  } as const;
  const candidate = (() => {
    switch (resource.kind) {
      case "payment": {
        const statuses = {
          created: "CREATED",
          requires_action: "REQUIRES_ACTION",
          processing: "PROCESSING",
          captured: "SUCCEEDED",
          failed: "FAILED",
          canceled: "CANCELED",
          expired: "EXPIRED",
          unknown: "UNKNOWN",
        } as const;
        return {
          ...base,
          eventType: "PAYMENT_STATUS",
          status: statuses[resource.state],
        };
      }
      case "refund": {
        const statuses = {
          requested: "REQUESTED",
          submitting: "SUBMITTING",
          processing: "PROCESSING",
          succeeded: "SUCCEEDED",
          failed: "FAILED",
          unknown: "UNKNOWN",
        } as const;
        return {
          ...base,
          eventType: "REFUND_STATUS",
          refundReference: resource.refund_reference,
          status: statuses[resource.state],
        };
      }
      case "dispute":
        return {
          ...base,
          eventType: "DISPUTE_STATUS",
          disputeReference: resource.dispute_reference,
          status: resource.state.toUpperCase(),
        };
    }
  })();
  const parsed = verifiedWebhookEventCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function parseTimestamp(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined || !/^\d{10}$/u.test(timestamp)) {
    return undefined;
  }
  const milliseconds = Number(timestamp) * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function authenticate(
  rawBody: Uint8Array,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: Uint8Array,
): boolean {
  if (
    timestamp === undefined ||
    signature === undefined ||
    !/^v1=[0-9a-f]{64}$/u.test(signature)
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(timestamp, "utf8")
    .update(".", "utf8")
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signature.slice(3), "hex");
  return (
    supplied.byteLength === expected.byteLength &&
    timingSafeEqual(supplied, expected)
  );
}

export function createFakePaymentWebhookVerifier(
  options: FakePaymentWebhookVerifierOptions,
): PaymentWebhookVerifier {
  const parsedOptions = optionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    throw new TypeError("invalid fake payment webhook verifier options");
  }
  const configuration = parsedOptions.data;
  const secret = Buffer.from(configuration.verificationSecret);

  return Object.freeze({
    async verifyPaymentWebhook(command: PaymentWebhookVerificationCommand) {
      const parsedCommand =
        paymentWebhookVerificationCommandSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("INVALID_COMMAND");
      }
      const input = parsedCommand.data;
      if (
        configuration.environment === "LIVE" ||
        input.environment === "LIVE"
      ) {
        return failure("CONFIGURATION_ERROR");
      }
      if (
        input.endpointId !== configuration.endpointId ||
        input.providerAccountId !== configuration.providerAccountId ||
        input.environment !== configuration.environment ||
        input.verificationKeyReferenceHash !==
          configuration.verificationKeyReferenceHash
      ) {
        return failure("INVALID_COMMAND");
      }

      const rawBody = Buffer.from(input.rawBodyBase64, "base64url");
      const timestamp = input.headers[TIMESTAMP_HEADER];
      const signature = input.headers[SIGNATURE_HEADER];
      if (!authenticate(rawBody, timestamp, signature, secret)) {
        return failure("INVALID_SIGNATURE");
      }
      const signatureTimestampMs = parseTimestamp(timestamp);
      const receivedAtMs = Date.parse(input.receivedAt);
      if (
        signatureTimestampMs === undefined ||
        signatureTimestampMs < receivedAtMs - MAX_PAST_SKEW_MS ||
        signatureTimestampMs > receivedAtMs + MAX_FUTURE_SKEW_MS
      ) {
        return failure("EVENT_OUTSIDE_TOLERANCE");
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
        ) as unknown;
      } catch {
        return failure("MALFORMED_PROVIDER_RESPONSE");
      }
      if (unsupportedResourceKind(decoded)) {
        return failure("UNSUPPORTED_EVENT");
      }
      const providerPayload = providerWebhookSchema.safeParse(decoded);
      if (!providerPayload.success) {
        return failure("MALFORMED_PROVIDER_RESPONSE");
      }
      const candidate = normalizeProviderWebhook(providerPayload.data);
      if (candidate === undefined) {
        return failure("MALFORMED_PROVIDER_RESPONSE");
      }

      return paymentWebhookVerificationResponseSchema.parse({
        schemaVersion: 1,
        operation: "VERIFY_PAYMENT_WEBHOOK",
        outcome: "SUCCESS",
        value: {
          endpointId: input.endpointId,
          providerAccountId: input.providerAccountId,
          environment: input.environment,
          verificationKeyReferenceHash: input.verificationKeyReferenceHash,
          signatureTimestamp: new Date(signatureTimestampMs).toISOString(),
          candidate,
        },
      });
    },
  });
}
