import { createHash } from "node:crypto";

import {
  outboxDispatchJobSchema,
  reliableEventDeliveryContextSchema,
  webhookInboxJobSchema,
  type OutboxDispatchJob,
  type ReliableEventDeliveryContext,
  type WebhookInboxJob,
} from "@fan-support/contracts";
import { PgBoss, type QueueResult } from "pg-boss";

const expectedPgBossSchemaVersion = 40;
const gracefulStopTimeoutMs = 30_000;

const sourceQueueOptions = Object.freeze({
  policy: "standard" as const,
  partition: false,
  notify: false,
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 300,
  retentionSeconds: 1_209_600,
  deleteAfterSeconds: 604_800,
});

const deadLetterQueueOptions = Object.freeze({
  policy: "standard" as const,
  partition: false,
  notify: false,
  retryLimit: 0,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 300,
  retentionSeconds: 2_592_000,
  deleteAfterSeconds: 2_592_000,
});

export const RELIABLE_EVENT_QUEUE_NAMES = Object.freeze({
  webhookInbox: "payment-webhook-inbox-v1",
  webhookDeadLetter: "payment-webhook-dead-letter-v1",
  outboxDispatch: "outbox-dispatch-v1",
  outboxDeadLetter: "outbox-dispatch-dead-letter-v1",
});

export type QueueEngineConstructorOptions = Readonly<{
  connectionString: string;
  schema: string;
  migrate: boolean;
  createSchema: boolean;
  schedule: false;
  supervise: true;
  useListenNotify: false;
}>;

export type QueueEngineQueueOptions = Readonly<{
  policy: "standard";
  partition: false;
  notify: false;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
  expireInSeconds: number;
  retentionSeconds: number;
  deleteAfterSeconds: number;
  deadLetter?: string;
}>;

export type QueueEngineQueue = Readonly<{
  name: string;
  policy: string;
  partition: boolean;
  notify: boolean;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
  expireInSeconds: number;
  retentionSeconds: number;
  deleteAfterSeconds: number;
  deadLetter?: string;
}>;

export type QueueEngineDatabase = Readonly<{
  executeSql(
    text: string,
    values?: unknown[],
  ): Promise<Readonly<{ rows: unknown[] }>>;
}>;

export type QueueEngineSendOptions = Readonly<{
  id: string;
  db?: QueueEngineDatabase;
}>;

export type QueueEngineWorkOptions = Readonly<{
  batchSize: 1;
  includeMetadata: true;
  localConcurrency: number;
}>;

export type QueueEngineJob = Readonly<{
  id: string;
  data: unknown;
  retryCount: number;
}>;

export interface QueueEngine {
  start(): Promise<void>;
  stop(options: {
    close: true;
    graceful: true;
    timeout: number;
  }): Promise<void>;
  on(event: "error" | "warning", listener: (event: unknown) => void): void;
  off(event: "error" | "warning", listener: (event: unknown) => void): void;
  schemaVersion(): Promise<number | null>;
  createQueue(name: string, options: QueueEngineQueueOptions): Promise<void>;
  getQueue(name: string): Promise<QueueEngineQueue | null>;
  work(
    name: string,
    options: QueueEngineWorkOptions,
    handler: (jobs: readonly QueueEngineJob[]) => Promise<void>,
  ): Promise<string>;
  send(
    name: string,
    data: Readonly<Record<string, unknown>>,
    options: QueueEngineSendOptions,
  ): Promise<string | null>;
}

export type QueueEngineFactory = (
  options: QueueEngineConstructorOptions,
) => QueueEngine;

export type ReliableEventQueueInfrastructureNotice = Readonly<{
  schemaVersion: 1;
  severity: "ERROR" | "WARNING";
  code: "QUEUE_ENGINE_ERROR" | "QUEUE_ENGINE_WARNING";
}>;

export type PgBossReliableEventQueueOptions = Readonly<{
  schemaVersion: 1;
  connectionString: string;
  schema: string;
  managementMode: "PROVISION" | "VERIFY";
  localConcurrency: number;
  onInfrastructureNotice?: (
    notice: ReliableEventQueueInfrastructureNotice,
  ) => void | Promise<void>;
}>;

export type ReliableEventQueueExecutionContext = ReliableEventDeliveryContext;

export type ReliableEventQueueHandlers = Readonly<{
  processWebhookInbox(
    job: WebhookInboxJob,
    context: ReliableEventQueueExecutionContext,
  ): Promise<void>;
  dispatchOutboxEvent(
    job: OutboxDispatchJob,
    context: ReliableEventQueueExecutionContext,
  ): Promise<void>;
}>;

export interface ReliableEventQueueTransaction {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface PgBossReliableEventQueue {
  start(handlers?: ReliableEventQueueHandlers): Promise<void>;
  stop(): Promise<void>;
  publishWebhookInbox(
    transaction: ReliableEventQueueTransaction,
    job: unknown,
  ): Promise<void>;
  publishOutboxDispatch(job: unknown): Promise<void>;
}

export type PgBossReliableEventQueueErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_JOB"
  | "NOT_RUNNING"
  | "ENQUEUE_REJECTED"
  | "INVALID_TRANSACTION_RESULT"
  | "QUEUE_SCHEMA_MISMATCH"
  | "QUEUE_CONFIGURATION_MISMATCH"
  | "START_FAILED"
  | "STOP_FAILED";

export class PgBossReliableEventQueueError extends Error {
  public readonly schemaVersion = 1 as const;

  public constructor(public readonly code: PgBossReliableEventQueueErrorCode) {
    super(code);
    this.name = "PgBossReliableEventQueueError";
  }
}

type QueueDefinition = Readonly<{
  name: string;
  options: QueueEngineQueueOptions;
}>;

const queueDefinitions: readonly QueueDefinition[] = Object.freeze([
  Object.freeze({
    name: RELIABLE_EVENT_QUEUE_NAMES.webhookDeadLetter,
    options: deadLetterQueueOptions,
  }),
  Object.freeze({
    name: RELIABLE_EVENT_QUEUE_NAMES.outboxDeadLetter,
    options: deadLetterQueueOptions,
  }),
  Object.freeze({
    name: RELIABLE_EVENT_QUEUE_NAMES.webhookInbox,
    options: Object.freeze({
      ...sourceQueueOptions,
      deadLetter: RELIABLE_EVENT_QUEUE_NAMES.webhookDeadLetter,
    }),
  }),
  Object.freeze({
    name: RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch,
    options: Object.freeze({
      ...sourceQueueOptions,
      deadLetter: RELIABLE_EVENT_QUEUE_NAMES.outboxDeadLetter,
    }),
  }),
]);

function createDefaultQueueEngine(
  options: QueueEngineConstructorOptions,
): QueueEngine {
  const boss = new PgBoss(options);
  return {
    start: async () => {
      await boss.start();
    },
    stop: async (stopOptions) => {
      await boss.stop(stopOptions);
    },
    on: (event, listener) => {
      boss.on(event, listener);
    },
    off: (event, listener) => {
      boss.off(event, listener);
    },
    schemaVersion: () => boss.schemaVersion(),
    createQueue: (name, queueOptions) => boss.createQueue(name, queueOptions),
    getQueue: async (name) => {
      const queue = await boss.getQueue(name);
      return queue === null ? null : queueResultToEngineQueue(queue);
    },
    work: async (name, workOptions, handler) =>
      boss.work<unknown, void, QueueEngineWorkOptions>(
        name,
        workOptions,
        async (jobs) =>
          handler(
            jobs.map((job) => ({
              id: job.id,
              data: job.data,
              retryCount: job.retryCount,
            })),
          ),
      ),
    send: (name, data, sendOptions) => {
      const database = sendOptions.db;
      return boss.send(name, data, {
        id: sendOptions.id,
        ...(database === undefined
          ? {}
          : {
              db: {
                executeSql: async (text, values) => {
                  const result = await database.executeSql(text, values);
                  return { rows: [...result.rows] };
                },
              },
            }),
      });
    },
  };
}

function queueResultToEngineQueue(queue: QueueResult): QueueEngineQueue {
  return {
    name: queue.name,
    policy: queue.policy ?? "standard",
    partition: queue.partition ?? false,
    notify: queue.notify ?? false,
    retryLimit: queue.retryLimit ?? 0,
    retryDelay: queue.retryDelay ?? 0,
    retryBackoff: queue.retryBackoff ?? false,
    ...(queue.retryDelayMax === undefined || queue.retryDelayMax === null
      ? {}
      : { retryDelayMax: queue.retryDelayMax }),
    expireInSeconds: queue.expireInSeconds ?? 0,
    retentionSeconds: queue.retentionSeconds ?? 0,
    deleteAfterSeconds: queue.deleteAfterSeconds ?? 0,
    ...(queue.deadLetter === undefined || queue.deadLetter === null
      ? {}
      : { deadLetter: queue.deadLetter }),
  };
}

function validateOptions(options: PgBossReliableEventQueueOptions): void {
  if (
    options.schemaVersion !== 1 ||
    typeof options.connectionString !== "string" ||
    options.connectionString.length === 0 ||
    options.connectionString.length > 4_096 ||
    typeof options.schema !== "string" ||
    !/^[a-z][a-z0-9_]{0,62}$/u.test(options.schema) ||
    !["PROVISION", "VERIFY"].includes(options.managementMode) ||
    !Number.isInteger(options.localConcurrency) ||
    options.localConcurrency < 1 ||
    options.localConcurrency > 64 ||
    (options.onInfrastructureNotice !== undefined &&
      typeof options.onInfrastructureNotice !== "function")
  ) {
    throw new PgBossReliableEventQueueError("INVALID_CONFIGURATION");
  }
}

function validateHandlers(handlers: ReliableEventQueueHandlers): void {
  if (
    typeof handlers !== "object" ||
    handlers === null ||
    typeof handlers.processWebhookInbox !== "function" ||
    typeof handlers.dispatchOutboxEvent !== "function"
  ) {
    throw new PgBossReliableEventQueueError("INVALID_CONFIGURATION");
  }
}

function queueMatchesDefinition(
  queue: QueueEngineQueue,
  definition: QueueDefinition,
): boolean {
  const expected = definition.options;
  return (
    queue.name === definition.name &&
    queue.policy === expected.policy &&
    queue.partition === expected.partition &&
    queue.notify === expected.notify &&
    queue.retryLimit === expected.retryLimit &&
    queue.retryDelay === expected.retryDelay &&
    queue.retryBackoff === expected.retryBackoff &&
    (queue.retryDelayMax ?? null) === (expected.retryDelayMax ?? null) &&
    queue.expireInSeconds === expected.expireInSeconds &&
    queue.retentionSeconds === expected.retentionSeconds &&
    queue.deleteAfterSeconds === expected.deleteAfterSeconds &&
    (queue.deadLetter ?? null) === (expected.deadLetter ?? null)
  );
}

async function verifyQueueDefinitions(engine: QueueEngine): Promise<void> {
  for (const definition of queueDefinitions) {
    const queue = await engine.getQueue(definition.name);
    if (queue === null || !queueMatchesDefinition(queue, definition)) {
      throw new PgBossReliableEventQueueError("QUEUE_CONFIGURATION_MISMATCH");
    }
  }
}

function createTransactionalDatabase(
  transaction: ReliableEventQueueTransaction,
): QueueEngineDatabase {
  return {
    executeSql: async (text, values) => {
      const result = await transaction.query(text, values);
      if (typeof result !== "object" || result === null) {
        throw new PgBossReliableEventQueueError("INVALID_TRANSACTION_RESULT");
      }
      const rowsDescriptor = Object.getOwnPropertyDescriptor(result, "rows");
      if (
        rowsDescriptor === undefined ||
        !("value" in rowsDescriptor) ||
        !Array.isArray(rowsDescriptor.value)
      ) {
        throw new PgBossReliableEventQueueError("INVALID_TRANSACTION_RESULT");
      }
      return { rows: rowsDescriptor.value };
    },
  };
}

function requireExecutionContext(jobs: readonly QueueEngineJob[]): Readonly<{
  job: QueueEngineJob;
  context: ReliableEventQueueExecutionContext;
}> {
  const job = jobs[0];
  if (
    jobs.length !== 1 ||
    job === undefined ||
    typeof job.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      job.id,
    ) ||
    !Number.isSafeInteger(job.retryCount) ||
    job.retryCount < 0
  ) {
    throw new PgBossReliableEventQueueError("INVALID_JOB");
  }
  const context = reliableEventDeliveryContextSchema.safeParse({
    schemaVersion: 1,
    jobId: job.id,
    attemptNumber: job.retryCount + 1,
    maxAttempts: sourceQueueOptions.retryLimit + 1,
  });
  if (!context.success) {
    throw new PgBossReliableEventQueueError("INVALID_JOB");
  }
  return {
    job,
    context: Object.freeze(context.data),
  };
}

function outboxQueueJobId(job: OutboxDispatchJob): string {
  const namespace = Buffer.from("f58cd05d9b3b50f588a2cc10b1ef74df", "hex");
  const digest = createHash("sha256")
    .update(namespace)
    .update(RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch)
    .update("\0")
    .update(job.outboxEventId)
    .update("\0")
    .update(job.consumerKey)
    .digest();
  const versionByte = digest[6];
  const variantByte = digest[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new PgBossReliableEventQueueError("INVALID_JOB");
  }
  digest[6] = (versionByte & 0x0f) | 0x80;
  digest[8] = (variantByte & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeStartError(error: unknown): PgBossReliableEventQueueError {
  return error instanceof PgBossReliableEventQueueError
    ? error
    : new PgBossReliableEventQueueError("START_FAILED");
}

export function createPgBossReliableEventQueueWithFactory(
  options: PgBossReliableEventQueueOptions,
  engineFactory: QueueEngineFactory,
): PgBossReliableEventQueue {
  validateOptions(options);
  let engine: QueueEngine;
  try {
    engine = engineFactory({
      connectionString: options.connectionString,
      schema: options.schema,
      migrate: options.managementMode === "PROVISION",
      createSchema: options.managementMode === "PROVISION",
      schedule: false,
      supervise: true,
      useListenNotify: false,
    });
  } catch {
    throw new PgBossReliableEventQueueError("INVALID_CONFIGURATION");
  }

  const emitNotice = (notice: ReliableEventQueueInfrastructureNotice): void => {
    try {
      void Promise.resolve(options.onInfrastructureNotice?.(notice)).catch(
        () => undefined,
      );
    } catch {
      // Observability is best-effort and cannot crash queue processing.
    }
  };
  const handleError = (): void => {
    emitNotice(
      Object.freeze({
        schemaVersion: 1,
        severity: "ERROR",
        code: "QUEUE_ENGINE_ERROR",
      }),
    );
  };
  const handleWarning = (): void => {
    emitNotice(
      Object.freeze({
        schemaVersion: 1,
        severity: "WARNING",
        code: "QUEUE_ENGINE_WARNING",
      }),
    );
  };
  engine.on("error", handleError);
  engine.on("warning", handleWarning);

  let lifecycle: "NEW" | "STARTING" | "RUNNING" | "FAILED" | "STOPPED" = "NEW";
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let engineNeedsStop = false;
  let engineStopAttempted = false;
  let listenersAttached = true;

  const detachListeners = (): void => {
    if (!listenersAttached) {
      return;
    }
    listenersAttached = false;
    try {
      engine.off("error", handleError);
      engine.off("warning", handleWarning);
    } catch {
      // Listener cleanup cannot reveal supplier failures.
    }
  };

  const stopEngine = async (): Promise<void> => {
    if (!engineNeedsStop || engineStopAttempted) {
      return;
    }
    engineStopAttempted = true;
    await engine.stop({
      close: true,
      graceful: true,
      timeout: gracefulStopTimeoutMs,
    });
  };

  const start = (handlers?: ReliableEventQueueHandlers): Promise<void> => {
    if (startPromise !== undefined) {
      return startPromise;
    }
    if (lifecycle !== "NEW") {
      return Promise.reject(new PgBossReliableEventQueueError("NOT_RUNNING"));
    }
    lifecycle = "STARTING";
    startPromise = (async () => {
      try {
        if (handlers !== undefined) {
          validateHandlers(handlers);
        }
        engineNeedsStop = true;
        await engine.start();
        if ((await engine.schemaVersion()) !== expectedPgBossSchemaVersion) {
          throw new PgBossReliableEventQueueError("QUEUE_SCHEMA_MISMATCH");
        }
        if (options.managementMode === "PROVISION") {
          for (const definition of queueDefinitions) {
            await engine.createQueue(definition.name, definition.options);
          }
        }
        await verifyQueueDefinitions(engine);
        if (handlers !== undefined) {
          await engine.work(
            RELIABLE_EVENT_QUEUE_NAMES.webhookInbox,
            {
              batchSize: 1,
              includeMetadata: true,
              localConcurrency: options.localConcurrency,
            },
            async (jobs) => {
              const { job, context } = requireExecutionContext(jobs);
              const parsed = webhookInboxJobSchema.safeParse(job.data);
              if (!parsed.success) {
                throw new PgBossReliableEventQueueError("INVALID_JOB");
              }
              await handlers.processWebhookInbox(parsed.data, context);
            },
          );
          await engine.work(
            RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch,
            {
              batchSize: 1,
              includeMetadata: true,
              localConcurrency: options.localConcurrency,
            },
            async (jobs) => {
              const { job, context } = requireExecutionContext(jobs);
              const parsed = outboxDispatchJobSchema.safeParse(job.data);
              if (!parsed.success) {
                throw new PgBossReliableEventQueueError("INVALID_JOB");
              }
              await handlers.dispatchOutboxEvent(parsed.data, context);
            },
          );
        }
        lifecycle = "RUNNING";
      } catch (error: unknown) {
        lifecycle = "FAILED";
        try {
          await stopEngine();
        } catch {
          // The original startup failure remains authoritative.
        }
        detachListeners();
        throw safeStartError(error);
      }
    })();
    return startPromise;
  };

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) {
      return stopPromise;
    }
    stopPromise = (async () => {
      if (startPromise !== undefined) {
        await startPromise.catch(() => undefined);
      }
      if (lifecycle !== "FAILED") {
        lifecycle = "STOPPED";
      }
      try {
        await stopEngine();
      } catch {
        throw new PgBossReliableEventQueueError("STOP_FAILED");
      } finally {
        lifecycle = "STOPPED";
        detachListeners();
      }
    })();
    return stopPromise;
  };

  const requireRunning = (): void => {
    if (lifecycle !== "RUNNING") {
      throw new PgBossReliableEventQueueError("NOT_RUNNING");
    }
  };

  const sendInTransaction = async (
    transaction: ReliableEventQueueTransaction,
    queueName: string,
    job: Readonly<Record<string, unknown>>,
    jobId: string,
  ): Promise<void> => {
    const sentId = await engine.send(queueName, job, {
      id: jobId,
      db: createTransactionalDatabase(transaction),
    });
    if (sentId === null) {
      throw new PgBossReliableEventQueueError("ENQUEUE_REJECTED");
    }
  };

  const queue: PgBossReliableEventQueue = {
    start,
    stop,
    publishWebhookInbox: async (transaction, job) => {
      requireRunning();
      const parsed = webhookInboxJobSchema.safeParse(job);
      if (!parsed.success) {
        throw new PgBossReliableEventQueueError("INVALID_JOB");
      }
      await sendInTransaction(
        transaction,
        RELIABLE_EVENT_QUEUE_NAMES.webhookInbox,
        parsed.data,
        parsed.data.webhookInboxId,
      );
    },
    publishOutboxDispatch: async (job) => {
      requireRunning();
      const parsed = outboxDispatchJobSchema.safeParse(job);
      if (!parsed.success) {
        throw new PgBossReliableEventQueueError("INVALID_JOB");
      }
      await engine.send(
        RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch,
        parsed.data,
        { id: outboxQueueJobId(parsed.data) },
      );
    },
  };
  return Object.freeze(queue);
}

export function createPgBossReliableEventQueue(
  options: PgBossReliableEventQueueOptions,
): PgBossReliableEventQueue {
  return createPgBossReliableEventQueueWithFactory(
    options,
    createDefaultQueueEngine,
  );
}
