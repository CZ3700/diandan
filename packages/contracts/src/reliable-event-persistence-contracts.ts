import { z } from "zod";

import {
  currencySchema,
  encryptedValueSchema,
  keyVersionSchema,
  marketSchema,
} from "./commerce.js";
import { eventEnvelopeSchema } from "./envelopes.js";
import {
  eventIdSchema,
  outboxDispatchAttemptIdSchema,
  outboxEffectReceiptIdSchema,
  paymentAttemptIdSchema,
  paymentWebhookEndpointIdSchema,
  providerAccountIdSchema,
  providerEventAssociationIdSchema,
  providerEventIdSchema,
  webhookEffectIdSchema,
  webhookInboxIdSchema,
  webhookPayloadIdSchema,
  webhookProcessingAttemptIdSchema,
} from "./identifiers.js";
import { paymentEnvironmentSchema, providerEventSchema } from "./payment.js";
import { portTimestampSchema } from "./port-common.js";
import {
  outboxDispatchJobSchema,
  queuePropagationCarrierSchema,
  reliableEventConsumerKeySchema,
  verifiedWebhookEventCandidateSchema,
  verificationKeyReferenceHashSchema,
  webhookInboxJobSchema,
} from "./reliable-events.js";
import { schemaVersionSchema } from "./versioning.js";

const positiveVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const boundedBatchSizeSchema = z.number().int().min(1).max(1_000);
const sha256HexSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/u);
const adapterKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/u);
const reasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const effectKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_:-]{0,127}$/u);

const endpointLifecycleSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ACTIVE"),
      activeFrom: portTimestampSchema,
    }),
    z.strictObject({
      status: z.literal("ROTATION_OVERLAP"),
      activeFrom: portTimestampSchema,
      overlapStartedAt: portTimestampSchema,
      retiredAt: portTimestampSchema,
    }),
  ])
  .superRefine((lifecycle, context) => {
    if (lifecycle.status !== "ROTATION_OVERLAP") {
      return;
    }
    const activeFromMs = Date.parse(lifecycle.activeFrom);
    const overlapStartedAtMs = Date.parse(lifecycle.overlapStartedAt);
    const retiredAtMs = Date.parse(lifecycle.retiredAt);
    if (overlapStartedAtMs < activeFromMs) {
      context.addIssue({
        code: "custom",
        path: ["overlapStartedAt"],
        message: "overlap must start after endpoint activation",
      });
    }
    if (
      retiredAtMs <= overlapStartedAtMs ||
      retiredAtMs > overlapStartedAtMs + 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["retiredAt"],
        message: "rotation overlap must be positive and at most 24 hours",
      });
    }
  });

/** Secret-free descriptor returned by the persistence boundary. */
export const paymentWebhookEndpointDescriptorSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  endpointId: paymentWebhookEndpointIdSchema,
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  adapterKey: adapterKeySchema,
  verificationKeyReferenceHash: verificationKeyReferenceHashSchema,
  lifecycle: endpointLifecycleSchema,
});

export const loadPaymentWebhookEndpointCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LOAD_PAYMENT_WEBHOOK_ENDPOINT"),
  endpointId: paymentWebhookEndpointIdSchema,
  receivedAt: portTimestampSchema,
});

export const loadPaymentWebhookEndpointResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LOAD_PAYMENT_WEBHOOK_ENDPOINT"),
  outcome: z.literal("SUCCESS"),
  value: z.discriminatedUnion("decision", [
    z.strictObject({
      decision: z.literal("ELIGIBLE"),
      endpoint: paymentWebhookEndpointDescriptorSchema,
    }),
    z.strictObject({ decision: z.literal("UNAVAILABLE") }),
  ]),
});

export const encryptedWebhookPayloadSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  webhookPayloadId: webhookPayloadIdSchema,
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  encryptionKeyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
  payloadSha256: sha256HexSchema,
  retentionExpiresAt: portTimestampSchema,
});

export const verifiedWebhookAssociationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    associationId: providerEventAssociationIdSchema,
    status: z.literal("UNMATCHED"),
    reasonCode: reasonCodeSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    associationId: providerEventAssociationIdSchema,
    status: z.literal("MATCHED"),
    paymentAttemptId: paymentAttemptIdSchema,
    reasonCode: reasonCodeSchema,
  }),
]);

export const recordVerifiedWebhookReceiptCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("RECORD_VERIFIED_WEBHOOK_RECEIPT"),
    endpoint: paymentWebhookEndpointDescriptorSchema,
    webhookPayload: encryptedWebhookPayloadSchema,
    webhookInboxId: webhookInboxIdSchema,
    providerEventRowId: providerEventIdSchema,
    association: verifiedWebhookAssociationSchema,
    signatureTimestamp: portTimestampSchema,
    receivedAt: portTimestampSchema,
    candidate: verifiedWebhookEventCandidateSchema,
    job: webhookInboxJobSchema,
  })
  .superRefine((command, context) => {
    if (command.job.webhookInboxId !== command.webhookInboxId) {
      context.addIssue({
        code: "custom",
        path: ["job", "webhookInboxId"],
        message: "job must identify the recorded webhook inbox row",
      });
    }

    const receivedAtMs = Date.parse(command.receivedAt);
    const signatureTimestampMs = Date.parse(command.signatureTimestamp);
    if (
      signatureTimestampMs < receivedAtMs - 10 * 60 * 1_000 ||
      signatureTimestampMs > receivedAtMs + 5 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["signatureTimestamp"],
        message: "signature timestamp is outside the database tolerance",
      });
    }

    const retentionExpiresAtMs = Date.parse(
      command.webhookPayload.retentionExpiresAt,
    );
    if (
      retentionExpiresAtMs <= receivedAtMs ||
      retentionExpiresAtMs > receivedAtMs + 7 * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["webhookPayload", "retentionExpiresAt"],
        message:
          "webhook payload retention must be positive and at most 7 days",
      });
    }

    const activeFromMs = Date.parse(command.endpoint.lifecycle.activeFrom);
    if (receivedAtMs < activeFromMs) {
      context.addIssue({
        code: "custom",
        path: ["endpoint", "lifecycle", "activeFrom"],
        message: "endpoint was not active when the webhook was received",
      });
    }
    if (
      command.endpoint.lifecycle.status === "ROTATION_OVERLAP" &&
      receivedAtMs > Date.parse(command.endpoint.lifecycle.retiredAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpoint", "lifecycle", "retiredAt"],
        message: "endpoint rotation overlap has expired",
      });
    }
  });

export const recordVerifiedWebhookReceiptResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_VERIFIED_WEBHOOK_RECEIPT"),
  outcome: z.literal("SUCCESS"),
  value: z.discriminatedUnion("decision", [
    z.strictObject({
      decision: z.literal("NEW"),
      webhookInboxId: webhookInboxIdSchema,
      providerEventRowId: providerEventIdSchema,
      jobEnqueued: z.literal(true),
    }),
    z.strictObject({
      decision: z.literal("REPLAY"),
      webhookInboxId: webhookInboxIdSchema,
      providerEventRowId: providerEventIdSchema,
    }),
    z.strictObject({
      decision: z.literal("CONFLICT"),
      conflictCode: z.literal("PROVIDER_EVENT_IDENTITY_MISMATCH"),
    }),
  ]),
});

export const loadWebhookProcessingContextCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LOAD_WEBHOOK_PROCESSING_CONTEXT"),
  webhookInboxId: webhookInboxIdSchema,
});

export const loadWebhookProcessingContextResponseSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("LOAD_WEBHOOK_PROCESSING_CONTEXT"),
    outcome: z.literal("SUCCESS"),
    value: z.discriminatedUnion("decision", [
      z.strictObject({
        decision: z.literal("READY"),
        webhookInboxId: webhookInboxIdSchema,
        providerEventRowId: providerEventIdSchema,
        event: providerEventSchema,
        nextAttemptNumber: positiveVersionSchema,
      }),
      z.strictObject({
        decision: z.literal("ALREADY_PROCESSED"),
        webhookInboxId: webhookInboxIdSchema,
        providerEventRowId: providerEventIdSchema,
      }),
    ]),
  })
  .superRefine((response, context) => {
    if (response.value.decision !== "READY") {
      return;
    }
    const evidence = response.value.event.evidence;
    if (
      evidence.kind !== "VERIFIED_WEBHOOK" ||
      evidence.webhookInboxId !== response.value.webhookInboxId
    ) {
      context.addIssue({
        code: "custom",
        path: ["value", "event", "evidence"],
        message: "processing context must carry matching webhook evidence",
      });
    }
  });

const webhookProcessingAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_WEBHOOK_PROCESSING_ATTEMPT"),
  processingAttemptId: webhookProcessingAttemptIdSchema,
  webhookInboxId: webhookInboxIdSchema,
  attemptNumber: positiveVersionSchema,
  startedAt: portTimestampSchema,
  finishedAt: portTimestampSchema,
} as const;

export const recordWebhookProcessingAttemptCommandSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      ...webhookProcessingAttemptBaseShape,
      outcome: z.literal("SUCCEEDED"),
    }),
    z.strictObject({
      ...webhookProcessingAttemptBaseShape,
      outcome: z.literal("RETRYABLE_FAILURE"),
      errorCode: reasonCodeSchema,
    }),
    z.strictObject({
      ...webhookProcessingAttemptBaseShape,
      outcome: z.literal("DEAD_LETTER"),
      errorCode: reasonCodeSchema,
    }),
  ])
  .superRefine((command, context) => {
    if (Date.parse(command.finishedAt) < Date.parse(command.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "attempt cannot finish before it starts",
      });
    }
  });

export const recordWebhookProcessingAttemptResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_WEBHOOK_PROCESSING_ATTEMPT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    decision: z.enum(["RECORDED", "REPLAY"]),
    processingAttemptId: webhookProcessingAttemptIdSchema,
    webhookInboxId: webhookInboxIdSchema,
    attemptNumber: positiveVersionSchema,
  }),
});

export const recordWebhookEffectCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_WEBHOOK_EFFECT"),
  webhookEffectId: webhookEffectIdSchema,
  webhookInboxId: webhookInboxIdSchema,
  effectKey: effectKeySchema,
  subjectId: z.uuid(),
});

export const recordWebhookEffectResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_WEBHOOK_EFFECT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    decision: z.enum(["RECORDED", "REPLAY"]),
    webhookInboxId: webhookInboxIdSchema,
    effectKey: effectKeySchema,
    subjectId: z.uuid(),
  }),
});

export const listReadyOutboxEventsCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LIST_READY_OUTBOX_EVENTS"),
  consumerKey: reliableEventConsumerKeySchema,
  availableAtOrBefore: portTimestampSchema,
  limit: boundedBatchSizeSchema,
  propagation: queuePropagationCarrierSchema,
});

export const listReadyOutboxEventsResponseSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("LIST_READY_OUTBOX_EVENTS"),
    outcome: z.literal("SUCCESS"),
    value: z.strictObject({
      jobs: z.array(outboxDispatchJobSchema).max(1_000),
    }),
  })
  .superRefine((response, context) => {
    const seen = new Set<string>();
    response.value.jobs.forEach((job, index) => {
      const key = `${String(job.outboxEventId)}:${job.consumerKey}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["value", "jobs", index],
          message: "outbox jobs must be unique by event and consumer",
        });
      }
      seen.add(key);
    });
  });

export const loadOutboxDispatchContextCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LOAD_OUTBOX_DISPATCH_CONTEXT"),
  outboxEventId: eventIdSchema,
  consumerKey: reliableEventConsumerKeySchema,
});

export const loadOutboxDispatchContextResponseSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("LOAD_OUTBOX_DISPATCH_CONTEXT"),
    outcome: z.literal("SUCCESS"),
    value: z.discriminatedUnion("decision", [
      z.strictObject({
        decision: z.literal("READY"),
        outboxEventId: eventIdSchema,
        consumerKey: reliableEventConsumerKeySchema,
        event: eventEnvelopeSchema,
        aggregateVersion: positiveVersionSchema,
        primarySubjectId: z.uuid(),
        secondarySubjectId: z.uuid().optional(),
        market: marketSchema.optional(),
        currency: currencySchema.optional(),
        nextAttemptNumber: positiveVersionSchema,
      }),
      z.strictObject({
        decision: z.literal("ALREADY_DISPATCHED"),
        outboxEventId: eventIdSchema,
        consumerKey: reliableEventConsumerKeySchema,
      }),
    ]),
  })
  .superRefine((response, context) => {
    if (response.value.decision !== "READY") {
      return;
    }
    if (response.value.outboxEventId !== response.value.event.eventId) {
      context.addIssue({
        code: "custom",
        path: ["value", "event", "eventId"],
        message: "dispatch context must identify the canonical outbox event",
      });
    }
    if (response.value.primarySubjectId !== response.value.event.aggregateId) {
      context.addIssue({
        code: "custom",
        path: ["value", "primarySubjectId"],
        message: "primary subject must match the event aggregate",
      });
    }
  });

const outboxDispatchAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_OUTBOX_DISPATCH_ATTEMPT"),
  dispatchAttemptId: outboxDispatchAttemptIdSchema,
  outboxEventId: eventIdSchema,
  consumerKey: reliableEventConsumerKeySchema,
  attemptNumber: positiveVersionSchema,
  startedAt: portTimestampSchema,
  finishedAt: portTimestampSchema,
} as const;

export const recordOutboxDispatchAttemptCommandSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      ...outboxDispatchAttemptBaseShape,
      outcome: z.literal("SUCCEEDED"),
    }),
    z.strictObject({
      ...outboxDispatchAttemptBaseShape,
      outcome: z.literal("RETRYABLE_FAILURE"),
      errorCode: reasonCodeSchema,
    }),
    z.strictObject({
      ...outboxDispatchAttemptBaseShape,
      outcome: z.literal("DEAD_LETTER"),
      errorCode: reasonCodeSchema,
    }),
  ])
  .superRefine((command, context) => {
    if (Date.parse(command.finishedAt) < Date.parse(command.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "attempt cannot finish before it starts",
      });
    }
  });

export const recordOutboxDispatchAttemptResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_OUTBOX_DISPATCH_ATTEMPT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    decision: z.enum(["RECORDED", "REPLAY"]),
    dispatchAttemptId: outboxDispatchAttemptIdSchema,
    outboxEventId: eventIdSchema,
    consumerKey: reliableEventConsumerKeySchema,
    attemptNumber: positiveVersionSchema,
  }),
});

export const recordOutboxEffectCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_OUTBOX_EFFECT"),
  outboxEffectId: outboxEffectReceiptIdSchema,
  outboxEventId: eventIdSchema,
  consumerKey: reliableEventConsumerKeySchema,
  effectKey: effectKeySchema,
  subjectId: z.uuid(),
});

export const recordOutboxEffectResponseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_OUTBOX_EFFECT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    decision: z.enum(["RECORDED", "REPLAY"]),
    outboxEventId: eventIdSchema,
    consumerKey: reliableEventConsumerKeySchema,
    effectKey: effectKeySchema,
    subjectId: z.uuid(),
  }),
});

export const purgeExpiredWebhookPayloadsCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("PURGE_EXPIRED_WEBHOOK_PAYLOADS"),
  expiredAtOrBefore: portTimestampSchema,
  purgedAt: portTimestampSchema,
  limit: boundedBatchSizeSchema,
});

export const purgeExpiredWebhookPayloadsResponseSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("PURGE_EXPIRED_WEBHOOK_PAYLOADS"),
    outcome: z.literal("SUCCESS"),
    value: z.strictObject({
      purgedPayloadIds: z.array(webhookPayloadIdSchema).max(1_000),
      purgedCount: z.number().int().min(0).max(1_000),
    }),
  })
  .superRefine((response, context) => {
    if (
      new Set(response.value.purgedPayloadIds).size !==
      response.value.purgedPayloadIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["value", "purgedPayloadIds"],
        message: "purged payload identifiers must be unique",
      });
    }
    if (response.value.purgedCount !== response.value.purgedPayloadIds.length) {
      context.addIssue({
        code: "custom",
        path: ["value", "purgedCount"],
        message: "purged count must match the returned identifiers",
      });
    }
  });

export const reliableEventPersistenceOperationSchema = z.enum([
  "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
  "RECORD_VERIFIED_WEBHOOK_RECEIPT",
  "LOAD_WEBHOOK_PROCESSING_CONTEXT",
  "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
  "RECORD_WEBHOOK_EFFECT",
  "LIST_READY_OUTBOX_EVENTS",
  "LOAD_OUTBOX_DISPATCH_CONTEXT",
  "RECORD_OUTBOX_DISPATCH_ATTEMPT",
  "RECORD_OUTBOX_EFFECT",
  "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
]);

export const reliableEventPersistenceCommandSchema = z.union([
  loadPaymentWebhookEndpointCommandSchema,
  recordVerifiedWebhookReceiptCommandSchema,
  loadWebhookProcessingContextCommandSchema,
  recordWebhookProcessingAttemptCommandSchema,
  recordWebhookEffectCommandSchema,
  listReadyOutboxEventsCommandSchema,
  loadOutboxDispatchContextCommandSchema,
  recordOutboxDispatchAttemptCommandSchema,
  recordOutboxEffectCommandSchema,
  purgeExpiredWebhookPayloadsCommandSchema,
]);

export const reliableEventPersistenceResponseSchema = z.union([
  loadPaymentWebhookEndpointResponseSchema,
  recordVerifiedWebhookReceiptResponseSchema,
  loadWebhookProcessingContextResponseSchema,
  recordWebhookProcessingAttemptResponseSchema,
  recordWebhookEffectResponseSchema,
  listReadyOutboxEventsResponseSchema,
  loadOutboxDispatchContextResponseSchema,
  recordOutboxDispatchAttemptResponseSchema,
  recordOutboxEffectResponseSchema,
  purgeExpiredWebhookPayloadsResponseSchema,
]);

export type PaymentWebhookEndpointDescriptor = z.infer<
  typeof paymentWebhookEndpointDescriptorSchema
>;
export type EncryptedWebhookPayload = z.infer<
  typeof encryptedWebhookPayloadSchema
>;
export type VerifiedWebhookAssociation = z.infer<
  typeof verifiedWebhookAssociationSchema
>;
export type LoadPaymentWebhookEndpointCommand = z.infer<
  typeof loadPaymentWebhookEndpointCommandSchema
>;
export type LoadPaymentWebhookEndpointResponse = z.infer<
  typeof loadPaymentWebhookEndpointResponseSchema
>;
export type RecordVerifiedWebhookReceiptCommand = z.infer<
  typeof recordVerifiedWebhookReceiptCommandSchema
>;
export type RecordVerifiedWebhookReceiptResponse = z.infer<
  typeof recordVerifiedWebhookReceiptResponseSchema
>;
export type LoadWebhookProcessingContextCommand = z.infer<
  typeof loadWebhookProcessingContextCommandSchema
>;
export type LoadWebhookProcessingContextResponse = z.infer<
  typeof loadWebhookProcessingContextResponseSchema
>;
export type RecordWebhookProcessingAttemptCommand = z.infer<
  typeof recordWebhookProcessingAttemptCommandSchema
>;
export type RecordWebhookProcessingAttemptResponse = z.infer<
  typeof recordWebhookProcessingAttemptResponseSchema
>;
export type RecordWebhookEffectCommand = z.infer<
  typeof recordWebhookEffectCommandSchema
>;
export type RecordWebhookEffectResponse = z.infer<
  typeof recordWebhookEffectResponseSchema
>;
export type ListReadyOutboxEventsCommand = z.infer<
  typeof listReadyOutboxEventsCommandSchema
>;
export type ListReadyOutboxEventsResponse = z.infer<
  typeof listReadyOutboxEventsResponseSchema
>;
export type LoadOutboxDispatchContextCommand = z.infer<
  typeof loadOutboxDispatchContextCommandSchema
>;
export type LoadOutboxDispatchContextResponse = z.infer<
  typeof loadOutboxDispatchContextResponseSchema
>;
export type RecordOutboxDispatchAttemptCommand = z.infer<
  typeof recordOutboxDispatchAttemptCommandSchema
>;
export type RecordOutboxDispatchAttemptResponse = z.infer<
  typeof recordOutboxDispatchAttemptResponseSchema
>;
export type RecordOutboxEffectCommand = z.infer<
  typeof recordOutboxEffectCommandSchema
>;
export type RecordOutboxEffectResponse = z.infer<
  typeof recordOutboxEffectResponseSchema
>;
export type PurgeExpiredWebhookPayloadsCommand = z.infer<
  typeof purgeExpiredWebhookPayloadsCommandSchema
>;
export type PurgeExpiredWebhookPayloadsResponse = z.infer<
  typeof purgeExpiredWebhookPayloadsResponseSchema
>;
export type ReliableEventPersistenceOperation = z.infer<
  typeof reliableEventPersistenceOperationSchema
>;
export type ReliableEventPersistenceCommand = z.infer<
  typeof reliableEventPersistenceCommandSchema
>;
export type ReliableEventPersistenceResponse = z.infer<
  typeof reliableEventPersistenceResponseSchema
>;
