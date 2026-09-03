import { describe, expect, test } from "vitest";

import {
  createPgBossReliableEventQueueWithFactory,
  PgBossReliableEventQueueError,
  type QueueEngine,
  type QueueEngineConstructorOptions,
  type QueueEngineJob,
  type QueueEngineQueue,
  type QueueEngineQueueOptions,
  type QueueEngineSendOptions,
  type QueueEngineWorkOptions,
  type ReliableEventQueueHandlers,
} from "./pg-boss-queue.js";

const webhookInboxId = "10000000-0000-4000-8000-000000000001";
const outboxEventId = "20000000-0000-4000-8000-000000000001";

const propagation = {
  schemaVersion: 1,
  requestId: "40000000-0000-4000-8000-000000000002",
  traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
} as const;

const webhookJob = {
  schemaVersion: 1,
  jobType: "PROCESS_WEBHOOK_INBOX",
  webhookInboxId,
  correlationId: "30000000-0000-4000-8000-000000000001",
  propagation,
} as const;

const outboxJob = {
  schemaVersion: 1,
  jobType: "DISPATCH_OUTBOX_EVENT",
  outboxEventId,
  consumerKey: "payment-projection",
  correlationId: "30000000-0000-4000-8000-000000000002",
  propagation,
} as const;

type RecordedWork = Readonly<{
  name: string;
  options: QueueEngineWorkOptions;
  handler: (jobs: readonly QueueEngineJob[]) => Promise<void>;
}>;

type RecordedSend = Readonly<{
  name: string;
  data: Readonly<Record<string, unknown>>;
  options: QueueEngineSendOptions;
}>;

class RecordingQueueEngine implements QueueEngine {
  public readonly createQueueCalls: Array<
    readonly [string, QueueEngineQueueOptions]
  > = [];
  public readonly getQueueCalls: string[] = [];
  public readonly workCalls: RecordedWork[] = [];
  public readonly sendCalls: RecordedSend[] = [];
  public readonly stopCalls: Array<{
    close: true;
    graceful: true;
    timeout: number;
  }> = [];
  public startCalls = 0;
  public schemaVersionCalls = 0;
  public schemaVersionResult: number | null = 40;
  public startFailure: unknown;
  public stopFailure: unknown;
  public workFailureAt: number | undefined;
  public sendResult: string | null | undefined;
  public sendHook:
    ((options: QueueEngineSendOptions) => Promise<void>) | undefined;

  private readonly queues = new Map<string, QueueEngineQueue>();
  private readonly listeners = new Map<
    "error" | "warning",
    Set<(event: unknown) => void>
  >([
    ["error", new Set()],
    ["warning", new Set()],
  ]);

  public seedQueue(name: string, options: QueueEngineQueueOptions): void {
    this.queues.set(name, { name, ...options });
  }

  public async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startFailure !== undefined) {
      throw this.startFailure;
    }
  }

  public async stop(options: {
    close: true;
    graceful: true;
    timeout: number;
  }): Promise<void> {
    this.stopCalls.push(options);
    if (this.stopFailure !== undefined) {
      throw this.stopFailure;
    }
  }

  public on(
    event: "error" | "warning",
    listener: (event: unknown) => void,
  ): void {
    this.listeners.get(event)?.add(listener);
  }

  public off(
    event: "error" | "warning",
    listener: (event: unknown) => void,
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  public emit(event: "error" | "warning", value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }

  public listenerCount(event: "error" | "warning"): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public async schemaVersion(): Promise<number | null> {
    this.schemaVersionCalls += 1;
    return this.schemaVersionResult;
  }

  public async createQueue(
    name: string,
    options: QueueEngineQueueOptions,
  ): Promise<void> {
    this.createQueueCalls.push([name, options]);
    if (!this.queues.has(name)) {
      this.seedQueue(name, options);
    }
  }

  public async getQueue(name: string): Promise<QueueEngineQueue | null> {
    this.getQueueCalls.push(name);
    return this.queues.get(name) ?? null;
  }

  public async work(
    name: string,
    options: QueueEngineWorkOptions,
    handler: (jobs: readonly QueueEngineJob[]) => Promise<void>,
  ): Promise<string> {
    this.workCalls.push({ name, options, handler });
    if (this.workFailureAt === this.workCalls.length) {
      throw new Error("engine work failure containing [REDACTED_SECRET]");
    }
    return `worker-${this.workCalls.length}`;
  }

  public async send(
    name: string,
    data: Readonly<Record<string, unknown>>,
    options: QueueEngineSendOptions,
  ): Promise<string | null> {
    this.sendCalls.push({ name, data, options });
    await this.sendHook?.(options);
    return this.sendResult === undefined ? options.id : this.sendResult;
  }
}

function createHarness(
  mode: "PROVISION" | "VERIFY" = "PROVISION",
  overrides: Partial<RecordingQueueEngine> = {},
) {
  const engine = Object.assign(new RecordingQueueEngine(), overrides);
  const constructorOptions: QueueEngineConstructorOptions[] = [];
  const queue = createPgBossReliableEventQueueWithFactory(
    {
      schemaVersion: 1,
      connectionString: "postgresql://queue-user@db.internal/platform",
      schema: "pgboss",
      managementMode: mode,
      localConcurrency: 3,
    },
    (options) => {
      constructorOptions.push(options);
      return engine;
    },
  );
  return { constructorOptions, engine, queue } as const;
}

const noOpHandlers: ReliableEventQueueHandlers = {
  processWebhookInbox: async () => undefined,
  dispatchOutboxEvent: async () => undefined,
};

const sourceQueueOptions = {
  policy: "standard",
  partition: false,
  notify: false,
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 300,
  retentionSeconds: 1_209_600,
  deleteAfterSeconds: 604_800,
} as const;

const deadLetterQueueOptions = {
  policy: "standard",
  partition: false,
  notify: false,
  retryLimit: 0,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 300,
  retentionSeconds: 2_592_000,
  deleteAfterSeconds: 2_592_000,
} as const;

describe("pg-boss reliable event queue adapter", () => {
  test("provisions dead-letter queues first and registers bounded source workers", async () => {
    const { constructorOptions, engine, queue } = createHarness();

    await queue.start(noOpHandlers);

    expect(constructorOptions).toEqual([
      {
        connectionString: "postgresql://queue-user@db.internal/platform",
        schema: "pgboss",
        migrate: true,
        createSchema: true,
        schedule: false,
        supervise: true,
        useListenNotify: false,
      },
    ]);
    expect(engine.createQueueCalls).toEqual([
      ["payment-webhook-dead-letter-v1", deadLetterQueueOptions],
      ["outbox-dispatch-dead-letter-v1", deadLetterQueueOptions],
      [
        "payment-webhook-inbox-v1",
        {
          ...sourceQueueOptions,
          deadLetter: "payment-webhook-dead-letter-v1",
        },
      ],
      [
        "outbox-dispatch-v1",
        {
          ...sourceQueueOptions,
          deadLetter: "outbox-dispatch-dead-letter-v1",
        },
      ],
    ]);
    expect(engine.getQueueCalls).toEqual([
      "payment-webhook-dead-letter-v1",
      "outbox-dispatch-dead-letter-v1",
      "payment-webhook-inbox-v1",
      "outbox-dispatch-v1",
    ]);
    expect(
      engine.workCalls.map(({ name, options }) => ({ name, options })),
    ).toEqual([
      {
        name: "payment-webhook-inbox-v1",
        options: {
          batchSize: 1,
          includeMetadata: true,
          localConcurrency: 3,
        },
      },
      {
        name: "outbox-dispatch-v1",
        options: {
          batchSize: 1,
          includeMetadata: true,
          localConcurrency: 3,
        },
      },
    ]);
  });

  test("VERIFY mode disables runtime DDL and fails closed on queue drift", async () => {
    const { constructorOptions, engine, queue } = createHarness("VERIFY");
    engine.seedQueue("payment-webhook-dead-letter-v1", deadLetterQueueOptions);
    engine.seedQueue("outbox-dispatch-dead-letter-v1", deadLetterQueueOptions);
    engine.seedQueue("payment-webhook-inbox-v1", {
      ...sourceQueueOptions,
      deadLetter: "payment-webhook-dead-letter-v1",
    });
    engine.seedQueue("outbox-dispatch-v1", {
      ...sourceQueueOptions,
      deadLetter: "outbox-dispatch-dead-letter-v1",
      retryLimit: 4,
    });

    await expect(queue.start(noOpHandlers)).rejects.toMatchObject({
      code: "QUEUE_CONFIGURATION_MISMATCH",
    });
    expect(constructorOptions[0]).toMatchObject({
      migrate: false,
      createSchema: false,
    });
    expect(engine.createQueueCalls).toEqual([]);
    expect(engine.stopCalls).toEqual([
      { close: true, graceful: true, timeout: 30_000 },
    ]);
  });

  test("publishes a strict webhook job through the caller transaction", async () => {
    const { engine, queue } = createHarness();
    await queue.start();
    const statements: Array<readonly [string, readonly unknown[] | undefined]> =
      [];
    engine.sendHook = async ({ db }) => {
      await db.executeSql("SELECT queue_insert($1)", [webhookInboxId]);
    };
    const transaction = {
      query: async (text: string, values?: readonly unknown[]) => {
        statements.push([text, values]);
        return { rows: [{ id: webhookInboxId }] };
      },
    };

    await expect(
      queue.publishWebhookInbox(transaction, webhookJob),
    ).resolves.toBeUndefined();

    expect(statements).toEqual([["SELECT queue_insert($1)", [webhookInboxId]]]);
    expect(engine.sendCalls).toHaveLength(1);
    expect(engine.sendCalls[0]).toMatchObject({
      name: "payment-webhook-inbox-v1",
      data: webhookJob,
      options: { id: webhookInboxId },
    });
    expect(Object.keys(engine.sendCalls[0]?.options ?? {}).sort()).toEqual([
      "db",
      "id",
    ]);
  });

  test("derives stable consumer-scoped UUIDs for outbox jobs", async () => {
    const { engine, queue } = createHarness();
    await queue.start();
    const transaction = {
      query: async () => ({ rows: [] }),
    };

    await queue.publishOutboxDispatch(transaction, outboxJob);
    await queue.publishOutboxDispatch(transaction, outboxJob);
    await queue.publishOutboxDispatch(transaction, {
      ...outboxJob,
      consumerKey: "email-delivery",
    });

    const ids = engine.sendCalls.map(({ options }) => options.id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
    expect(ids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  test("rejects invalid or duplicate-suppressed publications without leaking data", async () => {
    const { engine, queue } = createHarness();
    await queue.start();
    const transaction = {
      query: async () => ({ rows: [] }),
    };
    const invalidJob = {
      ...webhookJob,
      rawBody: "[REDACTED_SECRET]",
    };

    await expect(
      queue.publishWebhookInbox(transaction, invalidJob),
    ).rejects.toMatchObject({ code: "INVALID_JOB" });
    expect(engine.sendCalls).toEqual([]);

    engine.sendResult = null;
    const failure = await queue
      .publishWebhookInbox(transaction, webhookJob)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PgBossReliableEventQueueError);
    expect(failure).toMatchObject({ code: "ENQUEUE_REJECTED" });
    expect(String(failure)).not.toContain("[REDACTED_SECRET]");
  });

  test("strictly parses consumed jobs and propagates handler failures unchanged", async () => {
    const { engine, queue } = createHarness();
    const handled: unknown[] = [];
    const handlerFailure = new Error("retry the database transaction");
    await queue.start({
      processWebhookInbox: async (job, context) => {
        handled.push({ job, context });
        throw handlerFailure;
      },
      dispatchOutboxEvent: async () => undefined,
    });
    const webhookWorker = engine.workCalls[0];
    expect(webhookWorker).toBeDefined();

    const invocation = webhookWorker?.handler([
      { id: webhookInboxId, data: webhookJob, retryCount: 2 },
    ]);
    await expect(invocation).rejects.toBe(handlerFailure);
    expect(handled).toEqual([
      {
        job: webhookJob,
        context: {
          schemaVersion: 1,
          jobId: webhookInboxId,
          attemptNumber: 3,
          maxAttempts: 6,
        },
      },
    ]);

    await expect(
      webhookWorker?.handler([
        {
          id: webhookInboxId,
          data: { ...webhookJob, secret: "[REDACTED_SECRET]" },
          retryCount: 0,
        },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_JOB" });
    expect(handled).toHaveLength(1);
  });

  test("delivers the sixth source attempt and rejects impossible worker metadata", async () => {
    const { engine, queue } = createHarness();
    const handled: unknown[] = [];
    await queue.start({
      processWebhookInbox: async () => undefined,
      dispatchOutboxEvent: async (job, context) => {
        handled.push({ job, context });
      },
    });
    const outboxWorker = engine.workCalls[1];
    expect(outboxWorker).toBeDefined();

    await outboxWorker?.handler([
      {
        id: "50000000-0000-4000-8000-000000000001",
        data: outboxJob,
        retryCount: 5,
      },
    ]);
    expect(handled).toEqual([
      {
        job: outboxJob,
        context: {
          schemaVersion: 1,
          jobId: "50000000-0000-4000-8000-000000000001",
          attemptNumber: 6,
          maxAttempts: 6,
        },
      },
    ]);

    await expect(
      outboxWorker?.handler([
        {
          id: "50000000-0000-4000-8000-000000000001",
          data: outboxJob,
          retryCount: 6,
        },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_JOB" });
    await expect(
      outboxWorker?.handler([
        {
          id: "50000000-0000-4000-8000-000000000001",
          data: outboxJob,
          retryCount: 0,
        },
        {
          id: "50000000-0000-4000-8000-000000000002",
          data: outboxJob,
          retryCount: 0,
        },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_JOB" });
    expect(handled).toHaveLength(1);
  });

  test("fails closed when the transaction adapter does not return rows", async () => {
    const { engine, queue } = createHarness();
    await queue.start();
    engine.sendHook = async ({ db }) => {
      await db.executeSql("SELECT queue_insert($1)", [webhookInboxId]);
    };

    await expect(
      queue.publishWebhookInbox(
        { query: async () => ({ command: "SELECT" }) },
        webhookJob,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION_RESULT" });
  });

  test("checks the reviewed pg-boss schema before provisioning queues", async () => {
    const { engine, queue } = createHarness("PROVISION", {
      schemaVersionResult: 39,
    });

    await expect(queue.start(noOpHandlers)).rejects.toMatchObject({
      code: "QUEUE_SCHEMA_MISMATCH",
    });
    expect(engine.createQueueCalls).toEqual([]);
    expect(engine.workCalls).toEqual([]);
    expect(engine.stopCalls).toEqual([
      { close: true, graceful: true, timeout: 30_000 },
    ]);
  });

  test("emits only allowlisted infrastructure notices and contains observer failures", async () => {
    const notices: unknown[] = [];
    const engine = new RecordingQueueEngine();
    const queue = createPgBossReliableEventQueueWithFactory(
      {
        schemaVersion: 1,
        connectionString: "postgresql://queue-user@db.internal/platform",
        schema: "pgboss",
        managementMode: "PROVISION",
        localConcurrency: 1,
        onInfrastructureNotice: (notice) => {
          notices.push(notice);
          throw new Error("observer failure");
        },
      },
      () => engine,
    );
    expect(engine.listenerCount("error")).toBe(1);
    expect(engine.listenerCount("warning")).toBe(1);

    engine.emit("error", new Error("password=[REDACTED_SECRET]"));
    engine.emit("warning", {
      message: "queue data [REDACTED_SECRET]",
      payload: webhookJob,
    });
    await Promise.resolve();

    expect(notices).toEqual([
      {
        schemaVersion: 1,
        severity: "ERROR",
        code: "QUEUE_ENGINE_ERROR",
      },
      {
        schemaVersion: 1,
        severity: "WARNING",
        code: "QUEUE_ENGINE_WARNING",
      },
    ]);
    expect(JSON.stringify(notices)).not.toContain("[REDACTED_SECRET]");

    await queue.stop();
    expect(engine.listenerCount("error")).toBe(0);
    expect(engine.listenerCount("warning")).toBe(0);
  });

  test("makes start and graceful stop idempotent", async () => {
    const { engine, queue } = createHarness();

    const firstStart = queue.start(noOpHandlers);
    const secondStart = queue.start(noOpHandlers);
    expect(secondStart).toBe(firstStart);
    await firstStart;
    expect(engine.startCalls).toBe(1);
    expect(engine.workCalls).toHaveLength(2);

    const firstStop = queue.stop();
    const secondStop = queue.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(engine.stopCalls).toEqual([
      { close: true, graceful: true, timeout: 30_000 },
    ]);
  });

  test("cleans up a partial start and exposes no supplier error detail", async () => {
    const { engine, queue } = createHarness("PROVISION", {
      workFailureAt: 2,
    });

    const failure = await queue
      .start(noOpHandlers)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PgBossReliableEventQueueError);
    expect(failure).toMatchObject({ code: "START_FAILED" });
    expect(String(failure)).not.toContain("[REDACTED_SECRET]");
    expect(engine.stopCalls).toEqual([
      { close: true, graceful: true, timeout: 30_000 },
    ]);
    expect(engine.listenerCount("error")).toBe(0);
    await expect(queue.stop()).resolves.toBeUndefined();
    expect(engine.stopCalls).toHaveLength(1);
  });
});
