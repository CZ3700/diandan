import { z } from "zod";

import { currencySchema, minorAmountSchema } from "./commerce.js";
import { canonicalRequestIdSchema } from "./envelopes.js";
import {
  eventIdSchema,
  externalPaymentReferenceSchema,
  paymentWebhookEndpointIdSchema,
  providerAccountIdSchema,
  providerEventIdSchema,
  providerDisputeReferenceSchema,
  providerEventReferenceSchema,
  providerRefundReferenceSchema,
  providerTransactionReferenceSchema,
  webhookInboxIdSchema,
} from "./identifiers.js";
import {
  paymentAttemptStatusSchema,
  paymentEnvironmentSchema,
  refundStatusSchema,
} from "./payment.js";
import {
  containsC0OrDelControlCharacter,
  portBase64Schema,
  portErrorBaseShape,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import { schemaVersionSchema } from "./versioning.js";

export const verificationKeyReferenceHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/u)
  .brand<"VerificationKeyReferenceHash">();

export const paymentWebhookHeadersSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u),
    z
      .string()
      .max(8_192)
      .refine((value) => !containsC0OrDelControlCharacter(value), {
        message: "webhook header values must not contain control characters",
      }),
  )
  .superRefine((headers, context) => {
    const entries = Object.entries(headers);
    for (const forbiddenName of [
      "authorization",
      "cookie",
      "proxy-authorization",
      "set-cookie",
    ]) {
      if (Object.hasOwn(headers, forbiddenName)) {
        context.addIssue({
          code: "custom",
          path: [forbiddenName],
          message:
            "credential-bearing headers must not cross the verifier port",
        });
      }
    }
    if (entries.length > 64) {
      context.addIssue({
        code: "custom",
        message: "webhook headers must contain at most 64 fields",
      });
    }
    const encodedBytes = entries.reduce(
      (total, [name, value]) =>
        total +
        new TextEncoder().encode(name).byteLength +
        new TextEncoder().encode(value).byteLength +
        4,
      0,
    );
    if (encodedBytes > 32_768) {
      context.addIssue({
        code: "custom",
        message: "webhook headers must not exceed 32 KiB",
      });
    }
  });

const providerTransactionSchema = z.strictObject({
  type: z.enum(["AUTHORIZATION", "CAPTURE", "VOID", "REFUND", "CHARGEBACK"]),
  providerReference: providerTransactionReferenceSchema,
});

const verifiedWebhookCandidateBaseShape = {
  schemaVersion: schemaVersionSchema,
  providerEventId: providerEventReferenceSchema,
  occurredAt: portTimestampSchema,
  externalReference: externalPaymentReferenceSchema,
  transaction: providerTransactionSchema.optional(),
} as const;

/**
 * A provider-normalized candidate proves neither persistence nor association.
 * Application code may create canonical ProviderEvent evidence only after the
 * verified receipt and its database-derived association have been committed.
 */
export const verifiedWebhookEventCandidateSchema = z
  .discriminatedUnion("eventType", [
    z.strictObject({
      ...verifiedWebhookCandidateBaseShape,
      eventType: z.literal("PAYMENT_STATUS"),
      status: paymentAttemptStatusSchema,
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
    z.strictObject({
      ...verifiedWebhookCandidateBaseShape,
      eventType: z.literal("REFUND_STATUS"),
      refundReference: providerRefundReferenceSchema,
      status: refundStatusSchema,
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
    z.strictObject({
      ...verifiedWebhookCandidateBaseShape,
      eventType: z.literal("DISPUTE_STATUS"),
      disputeReference: providerDisputeReferenceSchema,
      status: z.enum(["OPEN", "WON", "LOST"]),
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
  ])
  .superRefine((candidate, context) => {
    const transactionType = candidate.transaction?.type;
    if (transactionType === undefined) {
      return;
    }
    const compatible = (() => {
      switch (transactionType) {
        case "AUTHORIZATION":
          return (
            candidate.eventType === "PAYMENT_STATUS" &&
            ["PROCESSING", "SUCCEEDED"].includes(candidate.status)
          );
        case "CAPTURE":
          return (
            candidate.eventType === "PAYMENT_STATUS" &&
            candidate.status === "SUCCEEDED"
          );
        case "VOID":
          return (
            candidate.eventType === "PAYMENT_STATUS" &&
            candidate.status === "CANCELED"
          );
        case "REFUND":
          return (
            candidate.eventType === "REFUND_STATUS" &&
            candidate.status === "SUCCEEDED"
          );
        case "CHARGEBACK":
          return (
            candidate.eventType === "DISPUTE_STATUS" &&
            ["OPEN", "LOST"].includes(candidate.status)
          );
      }
    })();
    if (!compatible) {
      context.addIssue({
        code: "custom",
        path: ["transaction", "type"],
        message: "provider transaction type does not match normalized webhook",
      });
    }
  })
  .brand<"VerifiedWebhookEventCandidate">();

export const paymentWebhookVerificationCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("VERIFY_PAYMENT_WEBHOOK"),
  endpointId: paymentWebhookEndpointIdSchema,
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  verificationKeyReferenceHash: verificationKeyReferenceHashSchema,
  rawBodyBase64: portBase64Schema,
  headers: paymentWebhookHeadersSchema,
  receivedAt: portTimestampSchema,
});

export const paymentWebhookVerificationErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "INVALID_SIGNATURE",
  "EVENT_OUTSIDE_TOLERANCE",
  "UNSUPPORTED_EVENT",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
]);

export const paymentWebhookVerificationErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: paymentWebhookVerificationErrorCodeSchema,
  })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: ["TEMPORARY_UNAVAILABLE", "UNEXPECTED_ADAPTER_FAILURE"],
    }),
  );

const paymentWebhookVerificationFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("VERIFY_PAYMENT_WEBHOOK"),
  outcome: z.literal("FAILURE"),
  error: paymentWebhookVerificationErrorSchema,
});

const paymentWebhookVerificationSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("VERIFY_PAYMENT_WEBHOOK"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    endpointId: paymentWebhookEndpointIdSchema,
    providerAccountId: providerAccountIdSchema,
    environment: paymentEnvironmentSchema,
    verificationKeyReferenceHash: verificationKeyReferenceHashSchema,
    signatureTimestamp: portTimestampSchema,
    candidate: verifiedWebhookEventCandidateSchema,
  }),
});

export const paymentWebhookVerificationResponseSchema = z.union([
  paymentWebhookVerificationSuccessSchema,
  paymentWebhookVerificationFailureSchema,
]);

export function paymentWebhookVerificationResponseMatchesCommand(
  command: unknown,
  response: unknown,
): boolean {
  const parsedCommand =
    paymentWebhookVerificationCommandSchema.safeParse(command);
  const parsedResponse =
    paymentWebhookVerificationResponseSchema.safeParse(response);
  if (!parsedCommand.success || !parsedResponse.success) {
    return false;
  }
  if (parsedResponse.data.outcome === "FAILURE") {
    return true;
  }
  const value = parsedResponse.data.value;
  const receivedAtMs = Date.parse(parsedCommand.data.receivedAt);
  const signatureTimestampMs = Date.parse(value.signatureTimestamp);
  return (
    value.endpointId === parsedCommand.data.endpointId &&
    value.providerAccountId === parsedCommand.data.providerAccountId &&
    value.environment === parsedCommand.data.environment &&
    value.verificationKeyReferenceHash ===
      parsedCommand.data.verificationKeyReferenceHash &&
    signatureTimestampMs >= receivedAtMs - 10 * 60 * 1_000 &&
    signatureTimestampMs <= receivedAtMs + 5 * 60 * 1_000
  );
}

export const queuePropagationCarrierSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  requestId: canonicalRequestIdSchema,
  traceparent: z
    .string()
    .regex(/^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-[0-9a-f]{2}$/u),
});

export const receivePaymentWebhookCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECEIVE_PAYMENT_WEBHOOK"),
  endpointId: paymentWebhookEndpointIdSchema,
  rawBodyBase64: portBase64Schema,
  headers: paymentWebhookHeadersSchema,
  receivedAt: portTimestampSchema,
  correlationId: z.uuid(),
  propagation: queuePropagationCarrierSchema,
});

export const receivePaymentWebhookErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "ENDPOINT_UNAVAILABLE",
  "INVALID_SIGNATURE",
  "EVENT_OUTSIDE_TOLERANCE",
  "UNSUPPORTED_EVENT",
  "IDEMPOTENCY_CONFLICT",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
]);

export const receivePaymentWebhookErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: receivePaymentWebhookErrorCodeSchema,
  })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: ["TEMPORARY_UNAVAILABLE"],
    }),
  );

const receivePaymentWebhookSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECEIVE_PAYMENT_WEBHOOK"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    decision: z.enum(["ACCEPTED_NEW", "ACCEPTED_REPLAY"]),
    webhookInboxId: webhookInboxIdSchema,
    providerEventRowId: providerEventIdSchema,
  }),
});

const receivePaymentWebhookFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECEIVE_PAYMENT_WEBHOOK"),
  outcome: z.literal("FAILURE"),
  error: receivePaymentWebhookErrorSchema,
});

export const receivePaymentWebhookResponseSchema = z.union([
  receivePaymentWebhookSuccessSchema,
  receivePaymentWebhookFailureSchema,
]);

export const webhookInboxJobSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobType: z.literal("PROCESS_WEBHOOK_INBOX"),
  webhookInboxId: webhookInboxIdSchema,
  correlationId: z.uuid(),
  propagation: queuePropagationCarrierSchema,
});

export const reliableEventConsumerKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u);

export const reliableEventDeliveryContextSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    jobId: z.uuid(),
    attemptNumber: z.number().int().min(1).max(6),
    maxAttempts: z.number().int().min(1).max(6),
  })
  .superRefine((context, refinement) => {
    if (context.attemptNumber > context.maxAttempts) {
      refinement.addIssue({
        code: "custom",
        path: ["attemptNumber"],
        message: "attempt number cannot exceed the configured maximum",
      });
    }
  });

export const outboxDispatchJobSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobType: z.literal("DISPATCH_OUTBOX_EVENT"),
  outboxEventId: eventIdSchema,
  consumerKey: reliableEventConsumerKeySchema,
  correlationId: z.uuid(),
  propagation: queuePropagationCarrierSchema,
});

export const reliableEventJobSchema = z.discriminatedUnion("jobType", [
  webhookInboxJobSchema,
  outboxDispatchJobSchema,
]);

export type VerifiedWebhookEventCandidate = z.infer<
  typeof verifiedWebhookEventCandidateSchema
>;
export type PaymentWebhookVerificationCommand = z.infer<
  typeof paymentWebhookVerificationCommandSchema
>;
export type PaymentWebhookVerificationResponse = z.infer<
  typeof paymentWebhookVerificationResponseSchema
>;
export type PaymentWebhookVerificationError = z.infer<
  typeof paymentWebhookVerificationErrorSchema
>;
export type QueuePropagationCarrier = z.infer<
  typeof queuePropagationCarrierSchema
>;
export type ReceivePaymentWebhookCommand = z.infer<
  typeof receivePaymentWebhookCommandSchema
>;
export type ReceivePaymentWebhookResponse = z.infer<
  typeof receivePaymentWebhookResponseSchema
>;
export type ReceivePaymentWebhookError = z.infer<
  typeof receivePaymentWebhookErrorSchema
>;
export type ReliableEventDeliveryContext = z.infer<
  typeof reliableEventDeliveryContextSchema
>;
export type WebhookInboxJob = z.infer<typeof webhookInboxJobSchema>;
export type OutboxDispatchJob = z.infer<typeof outboxDispatchJobSchema>;
export type ReliableEventJob = z.infer<typeof reliableEventJobSchema>;
