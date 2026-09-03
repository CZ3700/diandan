import { expect, test, vi } from "vitest";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import {
  createDispatchOutboxEvent,
  ReliableEventProcessingError,
} from "./dispatch-outbox-event.js";

const IDS = {
  outbox: "40000000-0000-4000-8000-000000000001",
  paymentAttempt: "40000000-0000-4000-8000-000000000002",
  order: "40000000-0000-4000-8000-000000000003",
  request: "40000000-0000-4000-8000-000000000004",
  correlation: "40000000-0000-4000-8000-000000000005",
  queueJob: "40000000-0000-4000-8000-000000000006",
  effect: "40000000-0000-4000-8000-000000000007",
  attempt: "40000000-0000-4000-8000-000000000008",
} as const;

const JOB = {
  schemaVersion: 1,
  jobType: "DISPATCH_OUTBOX_EVENT",
  outboxEventId: IDS.outbox,
  consumerKey: "notification-provider",
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
  eventId: IDS.outbox,
  occurredAt: "2026-09-04T00:00:00.000Z",
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

function success(operation: string, value: unknown) {
  return { schemaVersion: 1, operation, outcome: "SUCCESS", value } as const;
}

function createHarness(
  options: Readonly<{
    alreadyDispatched?: boolean;
    dispatchFailure?: unknown;
    registered?: boolean;
  }> = {},
) {
  const loadContext = vi.fn(async () =>
    success(
      "LOAD_OUTBOX_DISPATCH_CONTEXT",
      options.alreadyDispatched
        ? {
            decision: "ALREADY_DISPATCHED",
            outboxEventId: IDS.outbox,
            consumerKey: JOB.consumerKey,
          }
        : {
            decision: "READY",
            outboxEventId: IDS.outbox,
            consumerKey: JOB.consumerKey,
            event: EVENT,
            aggregateVersion: 1,
            primarySubjectId: IDS.paymentAttempt,
            secondarySubjectId: IDS.order,
            market: "AMERICAS",
            currency: "USD",
            nextAttemptNumber: 1,
          },
    ),
  );
  const recordEffect = vi.fn(async () =>
    success("RECORD_OUTBOX_EFFECT", {
      decision: "RECORDED",
      outboxEventId: IDS.outbox,
      consumerKey: JOB.consumerKey,
      effectKey: "NOTIFICATION:SEND",
      subjectId: IDS.order,
    }),
  );
  const recordAttempt = vi.fn(
    async (command: Readonly<Record<string, unknown>>) =>
      success("RECORD_OUTBOX_DISPATCH_ATTEMPT", {
        decision: "RECORDED",
        dispatchAttemptId: command["dispatchAttemptId"],
        outboxEventId: IDS.outbox,
        consumerKey: JOB.consumerKey,
        attemptNumber: command["attemptNumber"],
      }),
  );
  const repositories = {
    paymentWebhookEndpoints: {},
    verifiedWebhookReceipts: {},
    webhookProcessing: {},
    outbox: {},
    outboxDispatch: { loadContext, recordEffect, recordAttempt },
    webhookPayloadRetention: {},
  };
  const runInReliableEventTransaction = vi.fn(
    async (_transactionOptions: unknown, work: (value: unknown) => unknown) =>
      work(repositories),
  );
  const dispatch = vi.fn(async () => {
    if (options.dispatchFailure !== undefined) {
      throw options.dispatchFailure;
    }
  });
  const effect = vi.fn(() => ({
    effectKey: "NOTIFICATION:SEND",
    subjectId: IDS.order,
  }));
  const consumerForKey = vi.fn(() =>
    options.registered === false
      ? undefined
      : {
          effect,
          dispatch,
        },
  );
  const generatedIds = [
    IDS.effect,
    IDS.attempt,
    "40000000-0000-4000-8000-000000000009",
  ];
  const times = [
    "2026-09-04T00:00:01.000Z",
    "2026-09-04T00:00:02.000Z",
    "2026-09-04T00:00:03.000Z",
  ];
  const run = createDispatchOutboxEvent({
    transactionManager: {
      runInReliableEventTransaction,
    } as unknown as ReliableEventTransactionManager,
    consumerForKey,
    createId: () => generatedIds.shift() ?? IDS.attempt,
    now: () => times.shift() ?? "2026-09-04T00:00:04.000Z",
  });
  return {
    consumerForKey,
    dispatch,
    effect,
    loadContext,
    recordAttempt,
    recordEffect,
    run,
  };
}

test("dispatches with a stable idempotency key before recording effect and success", async () => {
  const harness = createHarness();

  await expect(harness.run(JOB, DELIVERY)).resolves.toBeUndefined();

  expect(harness.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ event: EVENT }),
    {
      schemaVersion: 1,
      idempotencyKey: `${IDS.outbox}:${JOB.consumerKey}`,
    },
  );
  expect(harness.recordEffect).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "RECORD_OUTBOX_EFFECT",
    outboxEffectId: IDS.effect,
    outboxEventId: IDS.outbox,
    consumerKey: JOB.consumerKey,
    effectKey: "NOTIFICATION:SEND",
    subjectId: IDS.order,
  });
  expect(harness.effect).toHaveBeenCalledWith(
    expect.objectContaining({ event: EVENT }),
  );
  expect(harness.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
    harness.recordEffect.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
  );
  expect(harness.recordAttempt).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: "SUCCEEDED", attemptNumber: 1 }),
  );
});

test("acks an already dispatched redelivery without another external call", async () => {
  const harness = createHarness({ alreadyDispatched: true });

  await expect(
    harness.run(JOB, { ...DELIVERY, attemptNumber: 2 }),
  ).resolves.toBeUndefined();
  expect(harness.consumerForKey).not.toHaveBeenCalled();
  expect(harness.dispatch).not.toHaveBeenCalled();
  expect(harness.recordEffect).not.toHaveBeenCalled();
});

test("records a safe retryable attempt when the external consumer fails", async () => {
  const canary = "PRIVATE_NOTIFICATION_FAILURE_73519";
  const harness = createHarness({ dispatchFailure: new Error(canary) });

  const failure = await harness.run(JOB, DELIVERY).catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_EXECUTION_FAILED" });
  expect(String(failure)).not.toContain(canary);
  expect(harness.recordEffect).not.toHaveBeenCalled();
  expect(harness.recordAttempt).toHaveBeenLastCalledWith(
    expect.objectContaining({
      outcome: "RETRYABLE_FAILURE",
      errorCode: "HANDLER_EXECUTION_FAILED",
    }),
  );
});

test("dead-letters the final attempt when no production consumer is registered", async () => {
  const harness = createHarness({ registered: false });

  const failure = await harness
    .run(JOB, { ...DELIVERY, attemptNumber: 6 })
    .catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "HANDLER_NOT_REGISTERED" });
  expect(harness.recordAttempt).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "DEAD_LETTER",
      errorCode: "HANDLER_NOT_REGISTERED",
    }),
  );
});

test("rejects sensitive job extensions before loading an outbox event", async () => {
  const harness = createHarness();
  const failure = await harness
    .run({ ...JOB, payload: "PRIVATE_OUTBOX_CANARY" }, DELIVERY)
    .catch((error) => error);

  expect(failure).toBeInstanceOf(ReliableEventProcessingError);
  expect(failure).toMatchObject({ code: "INVALID_JOB" });
  expect(harness.loadContext).not.toHaveBeenCalled();
});
