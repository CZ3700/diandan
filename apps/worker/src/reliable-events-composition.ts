import { randomBytes, randomUUID } from "node:crypto";

import {
  createDispatchOutboxEvent,
  createListReadyOutboxJobs,
  createProcessWebhookInbox,
  createPurgeExpiredWebhookPayloads,
  type DispatchOutboxEventDependencies,
  type ProcessWebhookInboxDependencies,
} from "@fan-support/application";
import { resolveDatabaseRuntimeConfig } from "@fan-support/config/server";
import {
  queuePropagationCarrierSchema,
  type QueuePropagationCarrier,
} from "@fan-support/contracts";
import type { StructuredLogger } from "@fan-support/observability";
import {
  createPgBossReliableEventQueue,
  createPostgresPersistence,
  type PersistenceFailureNotice,
  type ReliableEventQueueInfrastructureNotice,
} from "@fan-support/persistence-postgres";

import {
  createReliableEventsWorkerRuntime,
  type ReliableEventsWorkerNotice,
  type ReliableEventsWorkerRuntime,
} from "./reliable-events-runtime.js";

const QUEUE_SCHEMA = "pgboss";
const LOCAL_CONCURRENCY = 4;
const MAINTENANCE_INTERVAL_MS = 5_000;
const MAINTENANCE_BATCH_SIZE = 100;

type QueueFactory = typeof createPgBossReliableEventQueue;
type PersistenceFactory = typeof createPostgresPersistence;
type RuntimeFactory = typeof createReliableEventsWorkerRuntime;

export type WorkerReliableEventsBindings = Readonly<{
  handlerForEvent: ProcessWebhookInboxDependencies["handlerForEvent"];
  consumerForKey: DispatchOutboxEventDependencies["consumerForKey"];
  consumerKeys: readonly string[];
}>;

export type WorkerReliableEventsCompositionFactories = Readonly<{
  createQueue: QueueFactory;
  createPersistence: PersistenceFactory;
  createRuntime: RuntimeFactory;
  createId(): string;
  now(): string;
  createPropagation(): QueuePropagationCarrier | undefined;
}>;

export type WorkerReliableEventsCompositionOptions = Readonly<{
  bindings?: Partial<WorkerReliableEventsBindings>;
  factories?: Partial<WorkerReliableEventsCompositionFactories>;
  logger?: StructuredLogger;
}>;

export type WorkerReliableEventsComposition = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export class WorkerReliableEventsCompositionError extends Error {
  public constructor(public readonly code: "STOP_FAILED") {
    super("Worker reliable-events composition failed");
    this.name = "WorkerReliableEventsCompositionError";
  }
}

function nonzeroHex(bytes: number): string {
  const value = randomBytes(bytes).toString("hex");
  return /^0+$/u.test(value) ? `${value.slice(0, -1)}1` : value;
}

function createMaintenancePropagation(): QueuePropagationCarrier {
  return queuePropagationCarrierSchema.parse({
    schemaVersion: 1,
    requestId: randomUUID(),
    traceparent: `00-${nonzeroHex(16)}-${nonzeroHex(8)}-01`,
  });
}

function reportQueueNotice(
  logger: StructuredLogger,
  notice: ReliableEventQueueInfrastructureNotice,
): void {
  const fields = { errorCode: notice.code, outcome: "failure" } as const;
  if (notice.severity === "ERROR") {
    logger.error("reliable_events.queue_notice", fields);
  } else {
    logger.warn("reliable_events.queue_notice", fields);
  }
}

function reportPersistenceFailure(
  logger: StructuredLogger,
  failure: PersistenceFailureNotice,
): void {
  logger.error("reliable_events.persistence_failure", {
    errorCode: failure.code,
    outcome: "failure",
  });
}

function reportWorkerNotice(
  logger: StructuredLogger,
  notice: ReliableEventsWorkerNotice,
): void {
  logger.warn("reliable_events.worker_notice", {
    errorCode: notice.code,
    outcome: "failure",
  });
}

const defaultBindings: WorkerReliableEventsBindings = Object.freeze({
  handlerForEvent: () => undefined,
  consumerForKey: () => undefined,
  consumerKeys: Object.freeze([]),
});

const defaultFactories: WorkerReliableEventsCompositionFactories =
  Object.freeze({
    createQueue: createPgBossReliableEventQueue,
    createPersistence: createPostgresPersistence,
    createRuntime: createReliableEventsWorkerRuntime,
    createId: randomUUID,
    now: () => new Date().toISOString(),
    createPropagation: createMaintenancePropagation,
  });

export function createWorkerReliableEventsComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: WorkerReliableEventsCompositionOptions = {},
): WorkerReliableEventsComposition {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const logger = options.logger;
  const suppliedFactories = options.factories;
  const factories: WorkerReliableEventsCompositionFactories = {
    createQueue: suppliedFactories?.createQueue ?? defaultFactories.createQueue,
    createPersistence:
      suppliedFactories?.createPersistence ??
      defaultFactories.createPersistence,
    createRuntime:
      suppliedFactories?.createRuntime ?? defaultFactories.createRuntime,
    createId: suppliedFactories?.createId ?? defaultFactories.createId,
    now: suppliedFactories?.now ?? defaultFactories.now,
    createPropagation:
      suppliedFactories?.createPropagation ??
      defaultFactories.createPropagation,
  };
  const suppliedBindings = options.bindings;
  const bindings: WorkerReliableEventsBindings = {
    handlerForEvent:
      suppliedBindings?.handlerForEvent ?? defaultBindings.handlerForEvent,
    consumerForKey:
      suppliedBindings?.consumerForKey ?? defaultBindings.consumerForKey,
    consumerKeys: Object.freeze([
      ...(suppliedBindings?.consumerKeys ?? defaultBindings.consumerKeys),
    ]),
  };

  const queue = factories.createQueue({
    schemaVersion: 1,
    connectionString: database.url,
    schema: QUEUE_SCHEMA,
    managementMode: "VERIFY",
    localConcurrency: LOCAL_CONCURRENCY,
    ...(logger === undefined
      ? {}
      : {
          onInfrastructureNotice: (notice) => reportQueueNotice(logger, notice),
        }),
  });
  const persistenceConfig = {
    connectionString: database.url,
    application_name: "fan-support-worker",
  } as const;
  const persistence =
    logger === undefined
      ? factories.createPersistence(persistenceConfig)
      : factories.createPersistence(persistenceConfig, {
          onInfrastructureFailure: (failure) =>
            reportPersistenceFailure(logger, failure),
        });
  const transactionManager = persistence.reliableEventTransactionManager;
  const runtime: ReliableEventsWorkerRuntime = factories.createRuntime({
    schemaVersion: 1,
    queue,
    processWebhookInbox: createProcessWebhookInbox({
      transactionManager,
      handlerForEvent: bindings.handlerForEvent,
      createId: factories.createId,
      now: factories.now,
    }),
    dispatchOutboxEvent: createDispatchOutboxEvent({
      transactionManager,
      consumerForKey: bindings.consumerForKey,
      createId: factories.createId,
      now: factories.now,
    }),
    listReadyOutboxJobs: createListReadyOutboxJobs({ transactionManager }),
    purgeExpiredWebhookPayloads: createPurgeExpiredWebhookPayloads({
      transactionManager,
    }),
    consumerKeys: bindings.consumerKeys,
    now: factories.now,
    createPropagation: factories.createPropagation,
    intervalMs: MAINTENANCE_INTERVAL_MS,
    batchSize: MAINTENANCE_BATCH_SIZE,
    ...(logger === undefined
      ? {}
      : {
          onNotice: (notice) => reportWorkerNotice(logger, notice),
        }),
  });
  let stopPromise: Promise<void> | undefined;

  return Object.freeze({
    start: () => runtime.start(),
    stop: () => {
      stopPromise ??= (async () => {
        let failed = false;
        try {
          await runtime.stop();
        } catch {
          failed = true;
        }
        try {
          await persistence.close();
        } catch {
          failed = true;
        }
        if (failed) {
          throw new WorkerReliableEventsCompositionError("STOP_FAILED");
        }
      })();
      return stopPromise;
    },
  });
}
