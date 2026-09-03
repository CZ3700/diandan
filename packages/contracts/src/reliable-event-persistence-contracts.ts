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
  providerEventReferenceSchema,
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
const receiptProviderEventIdentityShape = {
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  providerEventId: providerEventReferenceSchema,
} as const;

function fractionalSecondDigits(timestamp: string): number {
  return /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(timestamp)?.[1]?.length ?? 0;
}

/** PostgreSQL is the business truth source and persists timestamps to microseconds. */
const postgresTimestampSchema = portTimestampSchema.refine(
  (timestamp) => fractionalSecondDigits(timestamp) <= 6,
  { message: "database-bound timestamps support at most 6 fractional digits" },
);

function compareTimestampInstants(
  left: string,
  right: string,
  rightSecondOffset = 0,
): number | undefined {
  const parse = (
    timestamp: string,
  ): Readonly<{ seconds: number; fraction: string }> | undefined => {
    const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(
        timestamp,
      );
    if (match === null || match[1] === undefined || match[3] === undefined) {
      return undefined;
    }
    const milliseconds = Date.parse(`${match[1]}.000${match[3]}`);
    if (!Number.isFinite(milliseconds)) {
      return undefined;
    }
    return {
      seconds: Math.floor(milliseconds / 1_000),
      fraction: (match[2] ?? "").replace(/0+$/u, ""),
    };
  };
  const leftInstant = parse(left);
  const rightInstant = parse(right);
  if (leftInstant === undefined || rightInstant === undefined) {
    return undefined;
  }
  const adjustedRightSeconds = rightInstant.seconds + rightSecondOffset;
  if (leftInstant.seconds !== adjustedRightSeconds) {
    return leftInstant.seconds < adjustedRightSeconds ? -1 : 1;
  }
  const width = Math.max(
    leftInstant.fraction.length,
    rightInstant.fraction.length,
  );
  const leftFraction = leftInstant.fraction.padEnd(width, "0");
  const rightFraction = rightInstant.fraction.padEnd(width, "0");
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction < rightFraction ? -1 : 1;
}

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
    if (
      (compareTimestampInstants(
        lifecycle.overlapStartedAt,
        lifecycle.activeFrom,
      ) ?? -1) < 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["overlapStartedAt"],
        message: "overlap must start after endpoint activation",
      });
    }
    if (
      (compareTimestampInstants(
        lifecycle.retiredAt,
        lifecycle.overlapStartedAt,
      ) ?? 0) <= 0 ||
      (compareTimestampInstants(
        lifecycle.retiredAt,
        lifecycle.overlapStartedAt,
        24 * 60 * 60,
      ) ?? 1) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["retiredAt"],
        message: "rotation overlap must be positive and at most 24 hours",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "rotation overlap starts no earlier than endpoint activation",
      "rotation overlap retirement is after overlap start and no more than 24 hours later",
    ],
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
    if (fractionalSecondDigits(command.candidate.occurredAt) > 6) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "occurredAt"],
        message:
          "provider event time must preserve PostgreSQL microsecond precision without truncation",
      });
    }
    if (
      (compareTimestampInstants(
        command.candidate.occurredAt,
        command.receivedAt,
      ) ?? 1) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "occurredAt"],
        message: "provider event time cannot be after webhook receipt time",
      });
    }
    if (
      command.association.status === "MATCHED" &&
      command.candidate.transaction !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["association", "status"],
        message:
          "P1-06 webhook ingress cannot match transaction evidence without the same-transaction payment ledger contract",
      });
    }
    if (command.job.webhookInboxId !== command.webhookInboxId) {
      context.addIssue({
        code: "custom",
        path: ["job", "webhookInboxId"],
        message: "job must identify the recorded webhook inbox row",
      });
    }

    if (
      (compareTimestampInstants(
        command.signatureTimestamp,
        command.receivedAt,
        -10 * 60,
      ) ?? -1) < 0 ||
      (compareTimestampInstants(
        command.signatureTimestamp,
        command.receivedAt,
        5 * 60,
      ) ?? 1) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["signatureTimestamp"],
        message: "signature timestamp is outside the database tolerance",
      });
    }

    if (
      (compareTimestampInstants(
        command.webhookPayload.retentionExpiresAt,
        command.receivedAt,
      ) ?? 0) <= 0 ||
      (compareTimestampInstants(
        command.webhookPayload.retentionExpiresAt,
        command.receivedAt,
        7 * 24 * 60 * 60,
      ) ?? 1) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["webhookPayload", "retentionExpiresAt"],
        message:
          "webhook payload retention must be positive and at most 7 days",
      });
    }

    if (
      (compareTimestampInstants(
        command.receivedAt,
        command.endpoint.lifecycle.activeFrom,
      ) ?? -1) < 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpoint", "lifecycle", "activeFrom"],
        message: "endpoint was not active when the webhook was received",
      });
    }
    if (
      command.endpoint.lifecycle.status === "ROTATION_OVERLAP" &&
      (compareTimestampInstants(
        command.receivedAt,
        command.endpoint.lifecycle.retiredAt,
      ) ?? 0) >= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpoint", "lifecycle", "retiredAt"],
        message: "endpoint rotation overlap has expired",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "provider event occurredAt has at most six fractional digits and is not after receivedAt",
      "P1-06 ingress rejects MATCHED transaction evidence until a same-transaction payment ledger contract exists",
      "job webhookInboxId equals the recorded webhook inbox ID",
      "signatureTimestamp is within 10 minutes before through 5 minutes after receivedAt",
      "payload retention expires after receivedAt and no more than 7 days later",
      "receivedAt falls inside the endpoint active half-open lifecycle window",
    ],
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
      ...receiptProviderEventIdentityShape,
      jobEnqueued: z.literal(true),
    }),
    z.strictObject({
      decision: z.literal("REPLAY"),
      webhookInboxId: webhookInboxIdSchema,
      providerEventRowId: providerEventIdSchema,
      ...receiptProviderEventIdentityShape,
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
  })
  .meta({
    "x-runtime-invariants": [
      "READY processing context carries VERIFIED_WEBHOOK evidence for its webhookInboxId",
    ],
  });

const webhookProcessingAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_WEBHOOK_PROCESSING_ATTEMPT"),
  processingAttemptId: webhookProcessingAttemptIdSchema,
  webhookInboxId: webhookInboxIdSchema,
  attemptNumber: positiveVersionSchema,
  startedAt: postgresTimestampSchema,
  finishedAt: postgresTimestampSchema,
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
    if (
      (compareTimestampInstants(command.finishedAt, command.startedAt) ?? -1) <
      0
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "attempt cannot finish before it starts",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "attempt timestamps have at most six fractional digits",
      "finishedAt is not before startedAt",
    ],
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
  })
  .meta({
    "x-runtime-invariants": [
      "jobs are unique by outboxEventId and consumerKey",
    ],
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
    const event = response.value.event;
    let expectedPrimarySubjectId: string;
    let expectedSecondarySubjectId: string | undefined;
    let requiresContentRevisionSubject = false;
    switch (event.eventType) {
      case "CART_ITEM_ADDED":
        expectedPrimarySubjectId = event.payload.cartId;
        expectedSecondarySubjectId = event.payload.cartItemId;
        break;
      case "CONTENT_PUBLICATION_CHANGED":
        expectedPrimarySubjectId = event.payload.contentPublicationId;
        requiresContentRevisionSubject = true;
        break;
      case "PAYMENT_STATUS_CHANGED":
        expectedPrimarySubjectId = event.payload.paymentAttemptId;
        expectedSecondarySubjectId = event.payload.orderId;
        break;
      case "ORDER_PAYMENT_CONFIRMED":
        expectedPrimarySubjectId = event.payload.orderId;
        expectedSecondarySubjectId = event.payload.paymentAttemptId;
        break;
      case "REFUND_STATUS_CHANGED":
        expectedPrimarySubjectId = event.payload.refundId;
        expectedSecondarySubjectId = event.payload.orderId;
        break;
      case "DISPUTE_STATUS_CHANGED":
        expectedPrimarySubjectId = event.payload.disputeId;
        expectedSecondarySubjectId = event.payload.orderId;
        break;
      case "FULFILLMENT_STATUS_CHANGED":
        expectedPrimarySubjectId = event.payload.fulfillmentId;
        expectedSecondarySubjectId = event.payload.orderId;
        break;
      case "NOTIFICATION_REQUESTED":
        expectedPrimarySubjectId = event.payload.notificationDeliveryId;
        expectedSecondarySubjectId = event.payload.orderId;
        break;
      case "PAYMENT_CONFIG_PUBLISHED":
        expectedPrimarySubjectId = event.payload.paymentConfigPublicationId;
        break;
      case "PRICE_BOOK_PUBLISHED":
        expectedPrimarySubjectId = event.payload.priceBookPublicationId;
        expectedSecondarySubjectId = event.payload.priceBookId;
        break;
    }
    if (response.value.primarySubjectId !== expectedPrimarySubjectId) {
      context.addIssue({
        code: "custom",
        path: ["value", "primarySubjectId"],
        message: "primary subject must match the authoritative event subject",
      });
    }
    if (
      (requiresContentRevisionSubject &&
        response.value.secondarySubjectId === undefined) ||
      (!requiresContentRevisionSubject &&
        response.value.secondarySubjectId !== expectedSecondarySubjectId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value", "secondarySubjectId"],
        message: "secondary subject must match the authoritative event subject",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "READY outboxEventId equals the canonical event eventId",
      "READY primary and secondary subjects match the authoritative mapping for eventType",
      "CONTENT_PUBLICATION_CHANGED requires an explicit content revision secondary subject",
    ],
  });

const outboxDispatchAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECORD_OUTBOX_DISPATCH_ATTEMPT"),
  dispatchAttemptId: outboxDispatchAttemptIdSchema,
  outboxEventId: eventIdSchema,
  consumerKey: reliableEventConsumerKeySchema,
  attemptNumber: positiveVersionSchema,
  startedAt: postgresTimestampSchema,
  finishedAt: postgresTimestampSchema,
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
    if (
      (compareTimestampInstants(command.finishedAt, command.startedAt) ?? -1) <
      0
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "attempt cannot finish before it starts",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "attempt timestamps have at most six fractional digits",
      "finishedAt is not before startedAt",
    ],
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
  })
  .meta({
    "x-runtime-invariants": [
      "purged payload identifiers are unique",
      "purgedCount equals the number of returned payload identifiers",
    ],
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
