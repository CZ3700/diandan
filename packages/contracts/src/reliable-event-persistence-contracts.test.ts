import { expect, test } from "vitest";

import * as contracts from "./index.js";

type SchemaLike = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
  meta(): Readonly<Record<string, unknown>> | undefined;
}>;

const contractExports = contracts as Record<string, unknown>;

function schema(name: string): SchemaLike {
  const candidate = contractExports[name] as SchemaLike | undefined;
  expect(candidate, `${name} must be exported`).toBeDefined();
  return candidate as SchemaLike;
}

const IDS = {
  endpoint: "20000000-0000-4000-8000-000000000001",
  providerAccount: "20000000-0000-4000-8000-000000000002",
  webhookPayload: "20000000-0000-4000-8000-000000000003",
  webhookInbox: "20000000-0000-4000-8000-000000000004",
  providerEvent: "20000000-0000-4000-8000-000000000005",
  association: "20000000-0000-4000-8000-000000000006",
  paymentAttempt: "20000000-0000-4000-8000-000000000007",
  order: "20000000-0000-4000-8000-000000000008",
  processingAttempt: "20000000-0000-4000-8000-000000000009",
  webhookEffect: "20000000-0000-4000-8000-000000000010",
  outboxEvent: "20000000-0000-4000-8000-000000000011",
  dispatchAttempt: "20000000-0000-4000-8000-000000000012",
  outboxEffect: "20000000-0000-4000-8000-000000000013",
  subject: "20000000-0000-4000-8000-000000000014",
  request: "20000000-0000-4000-8000-000000000015",
  correlation: "20000000-0000-4000-8000-000000000016",
} as const;

const NOW = "2026-09-04T00:00:00.000Z";
const PROPAGATION = {
  schemaVersion: 1,
  requestId: IDS.request,
  traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
} as const;

const ENDPOINT = {
  schemaVersion: 1,
  endpointId: IDS.endpoint,
  providerAccountId: IDS.providerAccount,
  environment: "TEST",
  adapterKey: "fake_psp",
  verificationKeyReferenceHash: "a".repeat(64),
  lifecycle: { status: "ACTIVE", activeFrom: "2026-09-03T00:00:00.000Z" },
} as const;

const CANDIDATE = {
  schemaVersion: 1,
  providerEventId: "fake-event/payment/succeeded/1",
  occurredAt: "2026-09-03T23:59:59.000Z",
  externalReference: "fake-payment/1",
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  amountMinor: 2_500,
  currency: "USD",
  transaction: {
    type: "CAPTURE",
    providerReference: "fake-capture/1",
  },
} as const;

const INBOX_JOB = {
  schemaVersion: 1,
  jobType: "PROCESS_WEBHOOK_INBOX",
  webhookInboxId: IDS.webhookInbox,
  correlationId: IDS.correlation,
  propagation: PROPAGATION,
} as const;

const OUTBOX_JOB = {
  schemaVersion: 1,
  jobType: "DISPATCH_OUTBOX_EVENT",
  outboxEventId: IDS.outboxEvent,
  consumerKey: "notification-provider",
  correlationId: IDS.correlation,
  propagation: PROPAGATION,
} as const;

const PROVIDER_EVENT = {
  schemaVersion: 1,
  providerAccountId: IDS.providerAccount,
  environment: "TEST",
  providerEventId: CANDIDATE.providerEventId,
  evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: IDS.webhookInbox },
  occurredAt: CANDIDATE.occurredAt,
  association: {
    status: "MATCHED",
    paymentAttemptId: IDS.paymentAttempt,
    externalReference: CANDIDATE.externalReference,
  },
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  amountMinor: 2_500,
  currency: "USD",
  transaction: CANDIDATE.transaction,
} as const;

const OUTBOX_EVENT = {
  schemaVersion: 1,
  eventId: IDS.outboxEvent,
  occurredAt: NOW,
  correlationId: IDS.correlation,
  requestId: IDS.request,
  traceId: "a".repeat(32),
  eventType: "PAYMENT_STATUS_CHANGED",
  aggregateId: IDS.paymentAttempt,
  payload: {
    paymentAttemptId: IDS.paymentAttempt,
    orderId: IDS.order,
    status: "SUCCEEDED",
  },
} as const;

test("publishes cross-field reliable-event invariants for generated contract consumers", () => {
  for (const schemaName of [
    "recordVerifiedWebhookReceiptCommandSchema",
    "recordWebhookProcessingAttemptCommandSchema",
    "loadOutboxDispatchContextResponseSchema",
    "recordOutboxDispatchAttemptCommandSchema",
  ]) {
    expect(schema(schemaName).meta()).toMatchObject({
      "x-runtime-invariants": expect.any(Array),
    });
  }
});

test("loads only an eligible secret-free endpoint descriptor", () => {
  const commandSchema = schema("loadPaymentWebhookEndpointCommandSchema");
  const responseSchema = schema("loadPaymentWebhookEndpointResponseSchema");
  const descriptorSchema = schema("paymentWebhookEndpointDescriptorSchema");
  const command = {
    schemaVersion: 1,
    operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
    endpointId: IDS.endpoint,
    receivedAt: NOW,
  };

  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: command.operation,
      outcome: "SUCCESS",
      value: { decision: "ELIGIBLE", endpoint: ENDPOINT },
    }).success,
  ).toBe(true);
  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: command.operation,
      outcome: "SUCCESS",
      value: { decision: "UNAVAILABLE" },
    }).success,
  ).toBe(true);

  for (const forbidden of [
    { verificationSecret: "private" },
    { verificationSecretRef: "secret/provider/webhook" },
    { credentialSecretRef: "secret/provider/account" },
  ]) {
    expect(
      descriptorSchema.safeParse({ ...ENDPOINT, ...forbidden }).success,
    ).toBe(false);
  }
  expect(
    descriptorSchema.safeParse({ ...ENDPOINT, schemaVersion: 2 }).success,
  ).toBe(false);
  expect(
    descriptorSchema.safeParse({
      ...ENDPOINT,
      lifecycle: { status: "RETIRED", retiredAt: NOW },
    }).success,
  ).toBe(false);
  expect(
    descriptorSchema.safeParse({
      ...ENDPOINT,
      lifecycle: {
        status: "ROTATION_OVERLAP",
        activeFrom: "2026-09-03T00:00:00.000002Z",
        overlapStartedAt: "2026-09-03T00:00:00.000001Z",
        retiredAt: "2026-09-03T01:00:00.000001Z",
      },
    }).success,
  ).toBe(false);
});

test("records one verified receipt atomically and distinguishes replay from conflict", () => {
  const commandSchema = schema("recordVerifiedWebhookReceiptCommandSchema");
  const responseSchema = schema("recordVerifiedWebhookReceiptResponseSchema");
  const command = {
    schemaVersion: 1,
    operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    endpoint: ENDPOINT,
    webhookPayload: {
      schemaVersion: 1,
      webhookPayloadId: IDS.webhookPayload,
      ciphertext: `enc:v1:${"A".repeat(32)}`,
      encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
      encryptionKeyVersion: "webhook-2026-09",
      algorithm: "AES_256_GCM",
      payloadSha256: "b".repeat(64),
      retentionExpiresAt: "2026-09-11T00:00:00.000Z",
    },
    webhookInboxId: IDS.webhookInbox,
    providerEventRowId: IDS.providerEvent,
    association: {
      schemaVersion: 1,
      associationId: IDS.association,
      status: "UNMATCHED",
      reasonCode: "PAYMENT_ATTEMPT_NOT_FOUND",
    },
    signatureTimestamp: NOW,
    receivedAt: NOW,
    candidate: CANDIDATE,
    job: INBOX_JOB,
  } as const;

  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(
    commandSchema.safeParse({
      ...command,
      association: {
        schemaVersion: 1,
        associationId: IDS.association,
        status: "MATCHED",
        paymentAttemptId: IDS.paymentAttempt,
        reasonCode: "PAYMENT_ATTEMPT_MATCHED",
      },
    }).success,
  ).toBe(false);
  for (const value of [
    {
      decision: "NEW",
      webhookInboxId: IDS.webhookInbox,
      providerEventRowId: IDS.providerEvent,
      providerAccountId: ENDPOINT.providerAccountId,
      environment: ENDPOINT.environment,
      providerEventId: CANDIDATE.providerEventId,
      jobEnqueued: true,
    },
    {
      decision: "REPLAY",
      webhookInboxId: IDS.webhookInbox,
      providerEventRowId: IDS.providerEvent,
      providerAccountId: ENDPOINT.providerAccountId,
      environment: ENDPOINT.environment,
      providerEventId: CANDIDATE.providerEventId,
    },
    { decision: "CONFLICT", conflictCode: "PROVIDER_EVENT_IDENTITY_MISMATCH" },
  ]) {
    expect(
      responseSchema.safeParse({
        schemaVersion: 1,
        operation: command.operation,
        outcome: "SUCCESS",
        value,
      }).success,
    ).toBe(true);
  }

  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: command.operation,
      outcome: "SUCCESS",
      value: {
        decision: "REPLAY",
        webhookInboxId: IDS.webhookInbox,
        providerEventRowId: IDS.providerEvent,
      },
    }).success,
  ).toBe(false);

  expect(
    commandSchema.safeParse({
      ...command,
      job: { ...INBOX_JOB, webhookInboxId: IDS.subject },
    }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      signatureTimestamp: "2026-09-03T23:49:59.999Z",
    }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      webhookPayload: {
        ...command.webhookPayload,
        retentionExpiresAt: "2026-09-11T00:00:00.001Z",
      },
    }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      endpoint: {
        ...ENDPOINT,
        lifecycle: {
          status: "ROTATION_OVERLAP",
          activeFrom: "2026-09-03T00:00:00.000Z",
          overlapStartedAt: "2026-09-03T23:00:00.000Z",
          retiredAt: NOW,
        },
      },
    }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      candidate: {
        ...CANDIDATE,
        occurredAt: "2026-09-03T23:59:59.1234567Z",
      },
    }).success,
  ).toBe(false);
  expect(
    commandSchema.safeParse({
      ...command,
      candidate: {
        ...CANDIDATE,
        occurredAt: "2026-09-04T00:00:00.000001Z",
      },
    }).success,
  ).toBe(false);

  for (const forbidden of [
    { rawBodyBase64: "e30" },
    { headers: { "x-fake-signature": "private" } },
    { verificationSecret: "private" },
    { fanMessage: "private" },
    { email: "private@example.invalid" },
  ]) {
    expect(commandSchema.safeParse({ ...command, ...forbidden }).success).toBe(
      false,
    );
  }
});

test("loads a normalized webhook processing context without raw payload data", () => {
  const commandSchema = schema("loadWebhookProcessingContextCommandSchema");
  const responseSchema = schema("loadWebhookProcessingContextResponseSchema");
  const command = {
    schemaVersion: 1,
    operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
    webhookInboxId: IDS.webhookInbox,
  };
  const response = {
    schemaVersion: 1,
    operation: command.operation,
    outcome: "SUCCESS",
    value: {
      decision: "READY",
      webhookInboxId: IDS.webhookInbox,
      providerEventRowId: IDS.providerEvent,
      event: PROVIDER_EVENT,
      nextAttemptNumber: 1,
    },
  };

  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(responseSchema.safeParse(response).success).toBe(true);
  expect(
    responseSchema.safeParse({
      schemaVersion: 1,
      operation: command.operation,
      outcome: "SUCCESS",
      value: {
        decision: "ALREADY_PROCESSED",
        webhookInboxId: IDS.webhookInbox,
        providerEventRowId: IDS.providerEvent,
      },
    }).success,
  ).toBe(true);
  for (const forbidden of [
    { rawBodyBase64: "e30" },
    { ciphertext: `enc:v1:${"A".repeat(32)}` },
    { headers: { "x-fake-signature": "private" } },
  ]) {
    expect(
      responseSchema.safeParse({
        ...response,
        value: { ...response.value, ...forbidden },
      }).success,
    ).toBe(false);
  }
});

test("records bounded webhook attempts and idempotent database effects", () => {
  const attemptSchema = schema("recordWebhookProcessingAttemptCommandSchema");
  const effectSchema = schema("recordWebhookEffectCommandSchema");
  const effectResponseSchema = schema("recordWebhookEffectResponseSchema");
  const attempt = {
    schemaVersion: 1,
    operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
    processingAttemptId: IDS.processingAttempt,
    webhookInboxId: IDS.webhookInbox,
    attemptNumber: 1,
    outcome: "SUCCEEDED",
    startedAt: NOW,
    finishedAt: "2026-09-04T00:00:01.000Z",
  };
  const effect = {
    schemaVersion: 1,
    operation: "RECORD_WEBHOOK_EFFECT",
    webhookEffectId: IDS.webhookEffect,
    webhookInboxId: IDS.webhookInbox,
    effectKey: "P1_06:FIXTURE_EFFECT",
    subjectId: IDS.subject,
  };

  expect(attemptSchema.safeParse(attempt).success).toBe(true);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      outcome: "RETRYABLE_FAILURE",
      errorCode: "HANDLER_TEMPORARILY_UNAVAILABLE",
    }).success,
  ).toBe(true);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      outcome: "DEAD_LETTER",
      errorCode: "RETRY_BUDGET_EXHAUSTED",
    }).success,
  ).toBe(true);
  expect(
    attemptSchema.safeParse({ ...attempt, errorCode: "IMPOSSIBLE" }).success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      outcome: "RETRYABLE_FAILURE",
    }).success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({ ...attempt, finishedAt: "2026-09-03T23:59:59Z" })
      .success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      startedAt: "2026-09-04T00:00:00.0000001Z",
    }).success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      startedAt: "2026-09-04T00:00:00.000002Z",
      finishedAt: "2026-09-04T00:00:00.000001Z",
    }).success,
  ).toBe(false);

  expect(effectSchema.safeParse(effect).success).toBe(true);
  for (const decision of ["RECORDED", "REPLAY"] as const) {
    expect(
      effectResponseSchema.safeParse({
        schemaVersion: 1,
        operation: effect.operation,
        outcome: "SUCCESS",
        value: {
          decision,
          webhookInboxId: IDS.webhookInbox,
          effectKey: effect.effectKey,
          subjectId: IDS.subject,
        },
      }).success,
    ).toBe(true);
  }
  expect(
    effectSchema.safeParse({ ...effect, providerPayload: { private: true } })
      .success,
  ).toBe(false);
});

test("lists ID-only outbox jobs and loads canonical dispatch context", () => {
  const listCommandSchema = schema("listReadyOutboxEventsCommandSchema");
  const listResponseSchema = schema("listReadyOutboxEventsResponseSchema");
  const contextCommandSchema = schema("loadOutboxDispatchContextCommandSchema");
  const contextResponseSchema = schema(
    "loadOutboxDispatchContextResponseSchema",
  );
  const listCommand = {
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey: OUTBOX_JOB.consumerKey,
    availableAtOrBefore: NOW,
    limit: 100,
    propagation: PROPAGATION,
  };
  const contextCommand = {
    schemaVersion: 1,
    operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
    outboxEventId: IDS.outboxEvent,
    consumerKey: OUTBOX_JOB.consumerKey,
  };

  expect(listCommandSchema.safeParse(listCommand).success).toBe(true);
  expect(
    listResponseSchema.safeParse({
      schemaVersion: 1,
      operation: listCommand.operation,
      outcome: "SUCCESS",
      value: { jobs: [OUTBOX_JOB] },
    }).success,
  ).toBe(true);
  expect(
    listResponseSchema.safeParse({
      schemaVersion: 1,
      operation: listCommand.operation,
      outcome: "SUCCESS",
      value: { jobs: [OUTBOX_JOB, OUTBOX_JOB] },
    }).success,
  ).toBe(false);

  expect(contextCommandSchema.safeParse(contextCommand).success).toBe(true);
  expect(
    contextResponseSchema.safeParse({
      schemaVersion: 1,
      operation: contextCommand.operation,
      outcome: "SUCCESS",
      value: {
        decision: "READY",
        outboxEventId: IDS.outboxEvent,
        consumerKey: OUTBOX_JOB.consumerKey,
        event: OUTBOX_EVENT,
        aggregateVersion: 1,
        primarySubjectId: IDS.paymentAttempt,
        secondarySubjectId: IDS.order,
        market: "AMERICAS",
        currency: "USD",
        nextAttemptNumber: 1,
      },
    }).success,
  ).toBe(true);
  expect(
    contextResponseSchema.safeParse({
      schemaVersion: 1,
      operation: contextCommand.operation,
      outcome: "SUCCESS",
      value: {
        decision: "ALREADY_DISPATCHED",
        outboxEventId: IDS.outboxEvent,
        consumerKey: OUTBOX_JOB.consumerKey,
      },
    }).success,
  ).toBe(true);
});

test("records outbox attempts and database-local effect receipts", () => {
  const attemptSchema = schema("recordOutboxDispatchAttemptCommandSchema");
  const effectSchema = schema("recordOutboxEffectCommandSchema");
  const effectResponseSchema = schema("recordOutboxEffectResponseSchema");
  const attempt = {
    schemaVersion: 1,
    operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
    dispatchAttemptId: IDS.dispatchAttempt,
    outboxEventId: IDS.outboxEvent,
    consumerKey: OUTBOX_JOB.consumerKey,
    attemptNumber: 1,
    outcome: "SUCCEEDED",
    startedAt: NOW,
    finishedAt: "2026-09-04T00:00:01.000Z",
  };
  const effect = {
    schemaVersion: 1,
    operation: "RECORD_OUTBOX_EFFECT",
    outboxEffectId: IDS.outboxEffect,
    outboxEventId: IDS.outboxEvent,
    consumerKey: OUTBOX_JOB.consumerKey,
    effectKey: "NOTIFICATION:SEND",
    subjectId: IDS.subject,
  };

  expect(attemptSchema.safeParse(attempt).success).toBe(true);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      outcome: "RETRYABLE_FAILURE",
      errorCode: "PROVIDER_TEMPORARILY_UNAVAILABLE",
    }).success,
  ).toBe(true);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      outcome: "DEAD_LETTER",
      errorCode: "RETRY_BUDGET_EXHAUSTED",
    }).success,
  ).toBe(true);
  expect(
    attemptSchema.safeParse({ ...attempt, outcome: "DEAD_LETTER" }).success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      finishedAt: "2026-09-04T00:00:01.0000001Z",
    }).success,
  ).toBe(false);
  expect(
    attemptSchema.safeParse({
      ...attempt,
      startedAt: "2026-09-04T00:00:00.000002Z",
      finishedAt: "2026-09-04T00:00:00.000001Z",
    }).success,
  ).toBe(false);

  expect(effectSchema.safeParse(effect).success).toBe(true);
  for (const decision of ["RECORDED", "REPLAY"] as const) {
    expect(
      effectResponseSchema.safeParse({
        schemaVersion: 1,
        operation: effect.operation,
        outcome: "SUCCESS",
        value: {
          decision,
          outboxEventId: IDS.outboxEvent,
          consumerKey: OUTBOX_JOB.consumerKey,
          effectKey: effect.effectKey,
          subjectId: IDS.subject,
        },
      }).success,
    ).toBe(true);
  }
});

test("binds every outbox context to its authoritative primary and secondary subjects", () => {
  const responseSchema = schema("loadOutboxDispatchContextResponseSchema");
  const common = {
    schemaVersion: 1,
    eventId: IDS.outboxEvent,
    occurredAt: NOW,
    correlationId: IDS.correlation,
    requestId: IDS.request,
  } as const;
  const fixtures = [
    {
      event: {
        ...common,
        eventType: "CART_ITEM_ADDED",
        aggregateId: IDS.subject,
        payload: { cartId: IDS.subject, cartItemId: IDS.association },
      },
      primary: IDS.subject,
      secondary: IDS.association,
    },
    {
      event: {
        ...common,
        eventType: "CONTENT_PUBLICATION_CHANGED",
        aggregateId: IDS.subject,
        locale: "en",
        payload: { contentPublicationId: IDS.subject },
      },
      primary: IDS.subject,
      secondary: IDS.association,
    },
    {
      event: OUTBOX_EVENT,
      primary: IDS.paymentAttempt,
      secondary: IDS.order,
    },
    {
      event: {
        ...common,
        eventType: "ORDER_PAYMENT_CONFIRMED",
        aggregateId: IDS.order,
        payload: {
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
        },
      },
      primary: IDS.order,
      secondary: IDS.paymentAttempt,
    },
    {
      event: {
        ...common,
        eventType: "REFUND_STATUS_CHANGED",
        aggregateId: IDS.subject,
        payload: {
          refundId: IDS.subject,
          orderId: IDS.order,
          status: "SUCCEEDED",
        },
      },
      primary: IDS.subject,
      secondary: IDS.order,
    },
    {
      event: {
        ...common,
        eventType: "DISPUTE_STATUS_CHANGED",
        aggregateId: IDS.subject,
        payload: { disputeId: IDS.subject, orderId: IDS.order, status: "OPEN" },
      },
      primary: IDS.subject,
      secondary: IDS.order,
    },
    {
      event: {
        ...common,
        eventType: "FULFILLMENT_STATUS_CHANGED",
        aggregateId: IDS.subject,
        payload: {
          fulfillmentId: IDS.subject,
          orderId: IDS.order,
          status: "PREPARING",
        },
      },
      primary: IDS.subject,
      secondary: IDS.order,
    },
    {
      event: {
        ...common,
        eventType: "NOTIFICATION_REQUESTED",
        aggregateId: IDS.subject,
        payload: {
          notificationDeliveryId: IDS.subject,
          orderId: IDS.order,
        },
      },
      primary: IDS.subject,
      secondary: IDS.order,
    },
    {
      event: {
        ...common,
        eventType: "PAYMENT_CONFIG_PUBLISHED",
        aggregateId: IDS.subject,
        payload: {
          paymentConfigVersionId: IDS.subject,
          paymentConfigPublicationId: IDS.association,
        },
      },
      primary: IDS.association,
      secondary: undefined,
    },
    {
      event: {
        ...common,
        eventType: "PRICE_BOOK_PUBLISHED",
        aggregateId: IDS.subject,
        payload: {
          priceBookPublicationId: IDS.association,
          priceBookId: IDS.subject,
          priceBookRevision: 3,
          market: "AMERICAS",
          currency: "USD",
        },
      },
      primary: IDS.association,
      secondary: IDS.subject,
    },
  ] as const;

  for (const fixture of fixtures) {
    const value = {
      decision: "READY",
      outboxEventId: IDS.outboxEvent,
      consumerKey: OUTBOX_JOB.consumerKey,
      event: fixture.event,
      aggregateVersion: 1,
      primarySubjectId: fixture.primary,
      ...(fixture.secondary === undefined
        ? {}
        : { secondarySubjectId: fixture.secondary }),
      nextAttemptNumber: 1,
    };
    const response = {
      schemaVersion: 1,
      operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
      outcome: "SUCCESS",
      value,
    };
    expect(responseSchema.safeParse(response).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...response,
        value: { ...value, primarySubjectId: IDS.endpoint },
      }).success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        ...response,
        value: {
          ...value,
          secondarySubjectId:
            fixture.event.eventType === "CONTENT_PUBLICATION_CHANGED"
              ? undefined
              : fixture.secondary === undefined
                ? IDS.endpoint
                : IDS.providerEvent,
        },
      }).success,
    ).toBe(false);
  }
});

test("purges only bounded expired webhook payload identifiers", () => {
  const commandSchema = schema("purgeExpiredWebhookPayloadsCommandSchema");
  const responseSchema = schema("purgeExpiredWebhookPayloadsResponseSchema");
  const command = {
    schemaVersion: 1,
    operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
    expiredAtOrBefore: NOW,
    purgedAt: NOW,
    limit: 100,
  };
  const response = {
    schemaVersion: 1,
    operation: command.operation,
    outcome: "SUCCESS",
    value: {
      purgedPayloadIds: [IDS.webhookPayload],
      purgedCount: 1,
    },
  };

  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(responseSchema.safeParse(response).success).toBe(true);
  expect(
    responseSchema.safeParse({
      ...response,
      value: { ...response.value, purgedCount: 2 },
    }).success,
  ).toBe(false);
  expect(
    responseSchema.safeParse({
      ...response,
      value: {
        ...response.value,
        ciphertext: `enc:v1:${"A".repeat(32)}`,
      },
    }).success,
  ).toBe(false);
});

test("keeps reliable-event operations out of the frozen persistence v1 union", () => {
  const legacyOperationSchema = schema("persistencePortOperationSchema");
  const legacyCommandSchema = schema("persistencePortCommandSchema");
  const companionCommandSchema = schema(
    "reliableEventPersistenceCommandSchema",
  );
  const companionResponseSchema = schema(
    "reliableEventPersistenceResponseSchema",
  );

  expect(legacyOperationSchema.safeParse("BEGIN_IDEMPOTENCY").success).toBe(
    true,
  );
  expect(
    legacyOperationSchema.safeParse("RECORD_VERIFIED_WEBHOOK_RECEIPT").success,
  ).toBe(false);
  expect(
    legacyCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
      webhookInboxId: IDS.webhookInbox,
    }).success,
  ).toBe(false);
  expect(companionCommandSchema).toBeDefined();
  expect(companionResponseSchema).toBeDefined();
});
