import { expect, test, vi } from "vitest";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import {
  createProcessWebhookInbox,
  ReliableEventProcessingError,
} from "./process-webhook-inbox.js";

const IDS = {
  inbox: "30000000-0000-4000-8000-000000000001",
  providerEvent: "30000000-0000-4000-8000-000000000002",
  providerAccount: "30000000-0000-4000-8000-000000000003",
  paymentAttempt: "30000000-0000-4000-8000-000000000004",
  processingAttempt: "30000000-0000-4000-8000-000000000005",
  effect: "30000000-0000-4000-8000-000000000006",
  request: "30000000-0000-4000-8000-000000000007",
  correlation: "30000000-0000-4000-8000-000000000008",
  queueJob: "30000000-0000-4000-8000-000000000009",
  alternateInbox: "30000000-0000-4000-8000-000000000010",
  alternateProcessingAttempt: "30000000-0000-4000-8000-000000000011",
  alternateSubject: "30000000-0000-4000-8000-000000000012",
} as const;

const JOB = {
  schemaVersion: 1,
  jobType: "PROCESS_WEBHOOK_INBOX",
  webhookInboxId: IDS.inbox,
  correlationId: IDS.correlation,
  propagation: {
    schemaVersion: 1,
    requestId: IDS.request,
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  },
} as const;

const DELIVERY = {
  schemaVersion: 1,
  jobId: IDS.queueJob,
  attemptNumber: 1,
  maxAttempts: 6,
} as const;

const EVENT = {
  schemaVersion: 1,
  providerAccountId: IDS.providerAccount,
  environment: "TEST",
  providerEventId: "fake-event/payment/succeeded/1",
  evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: IDS.inbox },
  occurredAt: "2026-09-04T00:00:00.000Z",
  association: {
    status: "MATCHED",
    paymentAttemptId: IDS.paymentAttempt,
    externalReference: "fake-payment/1",
  },
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  amountMinor: 2_500,
  currency: "USD",
  transaction: {
    type: "CAPTURE",
    providerReference: "fake-capture/1",
  },
} as const;

function success(operation: string, value: unknown) {
  return { schemaVersion: 1, operation, outcome: "SUCCESS", value } as const;
}

function createHarness(
  options: Readonly<{
    alreadyProcessed?: boolean;
    handlerFailure?: unknown;
    invalidEffect?: boolean;
    registered?: boolean;
    registryFailure?: unknown;
  }> = {},
) {
  const loadContext = vi.fn(async () =>
    success(
      "LOAD_WEBHOOK_PROCESSING_CONTEXT",
      options.alreadyProcessed
        ? {
            decision: "ALREADY_PROCESSED",
            webhookInboxId: IDS.inbox,
            providerEventRowId: IDS.providerEvent,
          }
        : {
            decision: "READY",
            webhookInboxId: IDS.inbox,
            providerEventRowId: IDS.providerEvent,
            event: EVENT,
            nextAttemptNumber: 1,
          },
    ),
  );
  const recordEffect = vi.fn(async () =>
    success("RECORD_WEBHOOK_EFFECT", {
      decision: "RECORDED",
      webhookInboxId: IDS.inbox,
      effectKey: "P1_06:CANONICAL_EVENT",
      subjectId: IDS.providerEvent,
    }),
  );
  const recordAttempt = vi.fn(
    async (command: Readonly<Record<string, unknown>>) =>
      success("RECORD_WEBHOOK_PROCESSING_ATTEMPT", {
        decision: "RECORDED",
        processingAttemptId: command["processingAttemptId"],
        webhookInboxId: IDS.inbox,
        attemptNumber: command["attemptNumber"],
      }),
  );
  const repositories = {
    paymentWebhookEndpoints: {},
    verifiedWebhookReceipts: {},
    webhookProcessing: { loadContext, recordEffect, recordAttempt },
    outbox: {},
    outboxDispatch: {},
    webhookPayloadRetention: {},
  };
  const runInReliableEventTransaction = vi.fn(
    async (_transactionOptions: unknown, work: (value: unknown) => unknown) =>
      work(repositories),
  );
  const handle = vi.fn(async () => {
    if (options.handlerFailure !== undefined) {
      throw options.handlerFailure;
    }
  });
  const effect = vi.fn(() => ({
    effectKey: "P1_06:CANONICAL_EVENT",
    subjectId: options.invalidEffect ? "not-a-uuid" : IDS.providerEvent,
  }));
  const handlerForEvent = vi.fn(() => {
    if (options.registryFailure !== undefined) {
      throw options.registryFailure;
    }
    return options.registered === false
      ? undefined
      : {
          effect,
          handle,
        };
  });
  const generatedIds = [
    IDS.effect,
    IDS.processingAttempt,
    "30000000-0000-4000-8000-000000000010",
    "30000000-0000-4000-8000-000000000011",
  ];
  const times = [
    "2026-09-04T00:00:01.000Z",
    "2026-09-04T00:00:02.000Z",
    "2026-09-04T00:00:03.000Z",
    "2026-09-04T00:00:04.000Z",
  ];
  const process = createProcessWebhookInbox({
    transactionManager: {
      runInReliableEventTransaction,
    } as unknown as ReliableEventTransactionManager,
    handlerForEvent,
    createId: () => generatedIds.shift() ?? IDS.processingAttempt,
    now: () => times.shift() ?? "2026-09-04T00:00:05.000Z",
  });
  return {
    effect,
    handle,
    handlerForEvent,
    loadContext,
    process,
    recordAttempt,
    recordEffect,
    runInReliableEventTransaction,
  };
}

test("records the effect before one database-local handler and commits a successful attempt", async () => {
  const harness = createHarness();

  await expect(harness.process(JOB, DELIVERY)).resolves.toBeUndefined();

  expect(harness.recordEffect).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "RECORD_WEBHOOK_EFFECT",
    webhookEffectId: IDS.effect,
    webhookInboxId: IDS.inbox,
    effectKey: "P1_06:CANONICAL_EVENT",
    subjectId: IDS.providerEvent,
  });
  expect(harness.effect).toHaveBeenCalledWith(
    expect.objectContaining({ event: EVENT }),
  );
  expect(harness.handle).toHaveBeenCalledTimes(1);
  expect(harness.recordEffect.mock.invocationCallOrder[0]).toBeLessThan(
    harness.handle.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
  );
  expect(harness.recordAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
      outcome: "SUCCEEDED",
      webhookInboxId: IDS.inbox,
      attemptNumber: 1,
    }),
  );
});

test("acknowledges a commit-before-queue-ack redelivery without repeating the handler", async () => {
  const harness = createHarness({ alreadyProcessed: true });

  await expect(
    harness.process(JOB, { ...DELIVERY, attemptNumber: 2 }),
  ).resolves.toBeUndefined();
  expect(harness.handlerForEvent).not.toHaveBeenCalled();
  expect(harness.recordEffect).not.toHaveBeenCalled();
  expect(harness.recordAttempt).not.toHaveBeenCalled();
});

test("rejects a ready context bound to another webhook job before invoking a handler", async () => {
  const harness = createHarness();
  harness.loadContext.mockResolvedValueOnce(
    success("LOAD_WEBHOOK_PROCESSING_CONTEXT", {
      decision: "READY",
      webhookInboxId: IDS.alternateInbox,
      providerEventRowId: IDS.providerEvent,
      event: {
        ...EVENT,
        evidence: {
          kind: "VERIFIED_WEBHOOK",
          webhookInboxId: IDS.alternateInbox,
        },
      },
      nextAttemptNumber: 1,
    }),
  );

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
  expect(harness.handlerForEvent).not.toHaveBeenCalled();
  expect(harness.recordEffect).not.toHaveBeenCalled();
  expect(harness.recordAttempt).not.toHaveBeenCalled();
});

test("does not acknowledge an already-processed response bound to another webhook job", async () => {
  const harness = createHarness();
  harness.loadContext.mockResolvedValueOnce(
    success("LOAD_WEBHOOK_PROCESSING_CONTEXT", {
      decision: "ALREADY_PROCESSED",
      webhookInboxId: IDS.alternateInbox,
      providerEventRowId: IDS.providerEvent,
    }),
  );

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
  expect(harness.handlerForEvent).not.toHaveBeenCalled();
});

test("rejects an effect response bound to another command before invoking the handler", async () => {
  const harness = createHarness();
  harness.recordEffect.mockResolvedValueOnce(
    success("RECORD_WEBHOOK_EFFECT", {
      decision: "RECORDED",
      webhookInboxId: IDS.inbox,
      effectKey: "P1_06:CANONICAL_EVENT",
      subjectId: IDS.alternateSubject,
    }),
  );

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
  expect(harness.handle).not.toHaveBeenCalled();
  expect(harness.recordAttempt).not.toHaveBeenCalled();
});

test("rejects a success-attempt response bound to another command", async () => {
  const harness = createHarness();
  harness.recordAttempt.mockResolvedValueOnce(
    success("RECORD_WEBHOOK_PROCESSING_ATTEMPT", {
      decision: "RECORDED",
      processingAttemptId: IDS.alternateProcessingAttempt,
      webhookInboxId: IDS.inbox,
      attemptNumber: 1,
    }),
  );

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
});

test("rejects a failure-attempt response bound to another command", async () => {
  const harness = createHarness({ registered: false });
  harness.recordAttempt.mockResolvedValueOnce(
    success("RECORD_WEBHOOK_PROCESSING_ATTEMPT", {
      decision: "RECORDED",
      processingAttemptId: IDS.alternateProcessingAttempt,
      webhookInboxId: IDS.inbox,
      attemptNumber: 1,
    }),
  );

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "PERSISTENCE_FAILURE" });
});

test("rolls a private handler failure back, records only a safe retry attempt, and rethrows a safe error", async () => {
  const canary = "PRIVATE_PROVIDER_FAILURE_81357";
  const harness = createHarness({ handlerFailure: new Error(canary) });

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_EXECUTION_FAILED" });
  expect(String(failure)).not.toContain(canary);
  expect(harness.recordAttempt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      outcome: "RETRYABLE_FAILURE",
      errorCode: "HANDLER_EXECUTION_FAILED",
    }),
  );
});

test("records terminal failure on the final delivery and rejects unregistered handlers closed", async () => {
  const harness = createHarness({ registered: false });

  const failure = await harness
    .process(JOB, { ...DELIVERY, attemptNumber: 6 })
    .catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_NOT_REGISTERED" });
  expect(harness.recordEffect).not.toHaveBeenCalled();
  expect(harness.recordAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "DEAD_LETTER",
      errorCode: "HANDLER_NOT_REGISTERED",
    }),
  );
});

test("contains a failing handler registry and records a safe retry", async () => {
  const canary = "PRIVATE_HANDLER_REGISTRY_FAILURE_69213";
  const harness = createHarness({ registryFailure: new Error(canary) });

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_EXECUTION_FAILED" });
  expect(String(failure)).not.toContain(canary);
  expect(harness.handle).not.toHaveBeenCalled();
  expect(harness.recordAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "RETRYABLE_FAILURE",
      errorCode: "HANDLER_EXECUTION_FAILED",
    }),
  );
});

test("records a safe handler failure when derived effect identity is invalid", async () => {
  const harness = createHarness({ invalidEffect: true });

  const failure = await harness.process(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_EXECUTION_FAILED" });
  expect(harness.handle).not.toHaveBeenCalled();
  expect(harness.recordEffect).not.toHaveBeenCalled();
  expect(harness.recordAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "RETRYABLE_FAILURE",
      errorCode: "HANDLER_EXECUTION_FAILED",
    }),
  );
});

test("rejects unknown or sensitive job fields before touching persistence", async () => {
  const harness = createHarness();
  const failure = await harness
    .process({ ...JOB, rawBodyBase64: "PRIVATE_RAW_CANARY" }, DELIVERY)
    .catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "INVALID_JOB" });
  expect(harness.loadContext).not.toHaveBeenCalled();
});
