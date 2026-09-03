import { expect, test, vi } from "vitest";
import {
  currentRequestContext,
  startNodeTelemetry,
} from "@fan-support/observability/node";

const testDatabaseUrl = [
  "postgresql://",
  "test-user",
  ":",
  "test-password",
  "@postgres:5432/fan_support",
].join("");

const validEnvironment = Object.freeze({
  FAN_SUPPORT_DATABASE_URL: testDatabaseUrl,
});

const quietLogger = Object.freeze({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

async function loadFactory() {
  const module = (await import("./reliable-events-composition.js").catch(
    () => undefined,
  )) as
    | Readonly<{
        createWorkerReliableEventsComposition?: (
          environment: Readonly<Record<string, string | undefined>>,
          options?: unknown,
        ) => Promise<
          Readonly<{ start(): Promise<void>; stop(): Promise<void> }>
        >;
      }>
    | undefined;
  return module?.createWorkerReliableEventsComposition;
}

function createHarness() {
  const queue = Object.freeze({
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    publishWebhookInbox: vi.fn(async () => undefined),
    publishOutboxDispatch: vi.fn(async () => undefined),
  });
  const transactionManager = Object.freeze({
    runInReliableEventTransaction: vi.fn(async () => {
      throw new Error("transaction should not run in this wiring test");
    }),
  });
  const persistence = Object.freeze({
    transactionManager: Object.freeze({}),
    reliableEventTransactionManager: transactionManager,
    close: vi.fn(async () => undefined),
  });
  const runtime = Object.freeze({
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    runMaintenanceOnce: vi.fn(async () => undefined),
  });
  const runtimeOptions: unknown[] = [];
  const queueOptions: unknown[] = [];
  const persistenceArguments: unknown[][] = [];
  const createQueue = vi.fn((options: unknown) => {
    queueOptions.push(options);
    return queue;
  });
  const createPersistence = vi.fn((...arguments_: unknown[]) => {
    persistenceArguments.push(arguments_);
    return persistence;
  });
  const createRuntime = vi.fn((options: unknown) => {
    runtimeOptions.push(options);
    return runtime;
  });
  return {
    createPersistence,
    createQueue,
    createRuntime,
    persistence,
    persistenceArguments,
    queue,
    queueOptions,
    runtime,
    runtimeOptions,
  };
}

test("wires PostgreSQL, pg-boss VERIFY mode, application handlers, and maintenance", async () => {
  const factory = await loadFactory();
  expect(
    factory,
    "the Worker reliable-events composition must exist",
  ).toBeDefined();
  if (factory === undefined) {
    return;
  }
  const harness = createHarness();
  const propagation = {
    schemaVersion: 1,
    requestId: "30000000-0000-4000-8000-000000000001",
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  } as const;

  const composition = await factory(validEnvironment, {
    logger: quietLogger,
    factories: {
      createQueue: harness.createQueue,
      createPersistence: harness.createPersistence,
      createRuntime: harness.createRuntime,
      createId: () => "30000000-0000-4000-8000-000000000002",
      now: () => "2026-09-04T04:00:00.000Z",
      createPropagation: () => propagation,
    },
  });

  expect(harness.queueOptions).toEqual([
    {
      schemaVersion: 1,
      connectionString: validEnvironment.FAN_SUPPORT_DATABASE_URL,
      schema: "pgboss",
      managementMode: "VERIFY",
      localConcurrency: 4,
      onInfrastructureNotice: expect.any(Function),
    },
  ]);
  expect(harness.persistenceArguments).toEqual([
    [
      {
        connectionString: validEnvironment.FAN_SUPPORT_DATABASE_URL,
        application_name: "fan-support-worker",
      },
      { onInfrastructureFailure: expect.any(Function) },
    ],
  ]);
  expect(harness.runtimeOptions).toHaveLength(1);
  expect(harness.runtimeOptions[0]).toMatchObject({
    schemaVersion: 1,
    queue: harness.queue,
    consumerKeys: [],
    intervalMs: 5_000,
    batchSize: 100,
    onNotice: expect.any(Function),
  });
  expect(harness.runtimeOptions[0]).toEqual(
    expect.objectContaining({
      processWebhookInbox: expect.any(Function),
      dispatchOutboxEvent: expect.any(Function),
      runWithQueueContext: expect.any(Function),
      listReadyOutboxJobs: expect.any(Function),
      purgeExpiredWebhookPayloads: expect.any(Function),
      now: expect.any(Function),
      createPropagation: expect.any(Function),
    }),
  );

  await composition.start();
  await composition.stop();
  await composition.stop();
  expect(harness.runtime.start).toHaveBeenCalledTimes(1);
  expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
  expect(harness.persistence.close).toHaveBeenCalledTimes(1);
  expect(harness.runtime.stop.mock.invocationCallOrder[0]).toBeLessThan(
    harness.persistence.close.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER,
  );
});

test("closes persistence even when queue shutdown fails and exposes only a safe error", async () => {
  const factory = await loadFactory();
  expect(factory).toBeDefined();
  if (factory === undefined) {
    return;
  }
  const harness = createHarness();
  const canary = "PRIVATE_QUEUE_STOP_FAILURE_21698";
  harness.runtime.stop.mockRejectedValueOnce(new Error(canary));
  const composition = await factory(validEnvironment, {
    factories: {
      createQueue: harness.createQueue,
      createPersistence: harness.createPersistence,
      createRuntime: harness.createRuntime,
    },
  });

  const failure = await composition.stop().catch((error) => error);

  expect(failure).toMatchObject({ code: "STOP_FAILED" });
  expect(String(failure)).not.toContain(canary);
  expect(harness.persistence.close).toHaveBeenCalledTimes(1);
});

test("restores allowlisted queue propagation into a child worker span and rejects unsafe carriers", async () => {
  const factory = await loadFactory();
  expect(factory).toBeDefined();
  if (factory === undefined) {
    return;
  }
  const telemetry = startNodeTelemetry({ service: "worker" });
  const harness = createHarness();
  const logger = Object.freeze({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  const requestId = "30000000-0000-4000-8000-000000000003";
  const traceId = "a".repeat(32);
  const parentSpanId = "b".repeat(16);
  const job = Object.freeze({
    schemaVersion: 1,
    jobType: "PROCESS_WEBHOOK_INBOX",
    webhookInboxId: "10000000-0000-4000-8000-000000000003",
    correlationId: "20000000-0000-4000-8000-000000000003",
    propagation: Object.freeze({
      schemaVersion: 1,
      requestId,
      traceparent: `00-${traceId}-${parentSpanId}-01`,
    }),
  });

  try {
    await factory(validEnvironment, {
      logger,
      factories: {
        createQueue: harness.createQueue,
        createPersistence: harness.createPersistence,
        createRuntime: harness.createRuntime,
      },
    });
    const runtimeOptions = harness.runtimeOptions[0] as Readonly<{
      runWithQueueContext(
        candidate: unknown,
        handler: () => Promise<void>,
      ): Promise<void>;
    }>;
    let observed = currentRequestContext();

    await runtimeOptions.runWithQueueContext(job, async () => {
      observed = currentRequestContext();
    });

    expect(observed).toMatchObject({ requestId, traceId });
    expect(observed?.spanId).not.toBe(parentSpanId);
    expect(logger.info).toHaveBeenCalledWith(
      "http.request.completed",
      expect.objectContaining({
        requestId,
        traceId,
        httpRoute: "/jobs/payment-webhook-inbox",
      }),
    );

    await runtimeOptions.runWithQueueContext(
      {
        schemaVersion: 1,
        jobType: "DISPATCH_OUTBOX_EVENT",
        outboxEventId: "10000000-0000-4000-8000-000000000004",
        consumerKey: "notification-provider",
        correlationId: "20000000-0000-4000-8000-000000000004",
        propagation: job.propagation,
      },
      async () => undefined,
    );
    expect(logger.info).toHaveBeenLastCalledWith(
      "http.request.completed",
      expect.objectContaining({
        requestId,
        traceId,
        httpRoute: "/jobs/outbox-dispatch",
      }),
    );

    const canary = "PRIVATE_QUEUE_BAGGAGE_99123";
    const handler = vi.fn(async () => undefined);
    const failure = await runtimeOptions
      .runWithQueueContext(
        {
          ...job,
          propagation: { ...job.propagation, baggage: canary },
        },
        handler,
      )
      .catch((error) => error);

    expect(failure).toMatchObject({ code: "INVALID_PROPAGATION" });
    expect(String(failure)).not.toContain(canary);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(canary);
  } finally {
    await telemetry.shutdown();
  }
});
