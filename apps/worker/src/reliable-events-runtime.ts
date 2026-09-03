import type {
  OutboxDispatchJob,
  QueuePropagationCarrier,
  ReliableEventDeliveryContext,
  WebhookInboxJob,
} from "@fan-support/contracts";
import {
  portTimestampSchema,
  reliableEventConsumerKeySchema,
} from "@fan-support/contracts";

export type ReliableEventsWorkerNotice = Readonly<{
  schemaVersion: 1;
  severity: "WARNING";
  code:
    | "OUTBOX_RELAY_FAILED"
    | "PAYLOAD_PURGE_FAILED"
    | "MAINTENANCE_CONTEXT_UNAVAILABLE";
}>;

type ReliableEventQueue = Readonly<{
  start(handlers: {
    processWebhookInbox(
      job: WebhookInboxJob,
      context: ReliableEventDeliveryContext,
    ): Promise<void>;
    dispatchOutboxEvent(
      job: OutboxDispatchJob,
      context: ReliableEventDeliveryContext,
    ): Promise<void>;
  }): Promise<void>;
  stop(): Promise<void>;
  publishOutboxDispatch(job: OutboxDispatchJob): Promise<void>;
}>;

type ScheduledMaintenance = Readonly<{ cancel(): void }>;

export type ReliableEventsWorkerRuntimeOptions = Readonly<{
  schemaVersion: 1;
  queue: ReliableEventQueue;
  processWebhookInbox(
    job: WebhookInboxJob,
    context: ReliableEventDeliveryContext,
  ): Promise<void>;
  dispatchOutboxEvent(
    job: OutboxDispatchJob,
    context: ReliableEventDeliveryContext,
  ): Promise<void>;
  runWithQueueContext(
    job: WebhookInboxJob | OutboxDispatchJob,
    handler: () => Promise<void>,
  ): Promise<void>;
  listReadyOutboxJobs(command: unknown): Promise<readonly OutboxDispatchJob[]>;
  purgeExpiredWebhookPayloads(command: unknown): Promise<unknown>;
  consumerKeys: readonly string[];
  now(): string;
  createPropagation(): QueuePropagationCarrier | undefined;
  intervalMs: number;
  batchSize: number;
  schedule?: (tick: () => void, intervalMs: number) => ScheduledMaintenance;
  onNotice?: (notice: ReliableEventsWorkerNotice) => void | Promise<void>;
}>;

export type ReliableEventsWorkerRuntime = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  runMaintenanceOnce(): Promise<void>;
}>;

export type ReliableEventsWorkerRuntimeErrorCode =
  "INVALID_CONFIGURATION" | "START_FAILED" | "STOP_FAILED";

export class ReliableEventsWorkerRuntimeError extends Error {
  public constructor(
    public readonly code: ReliableEventsWorkerRuntimeErrorCode,
  ) {
    super("reliable event worker runtime failed");
    this.name = "ReliableEventsWorkerRuntimeError";
  }
}

function defaultSchedule(
  tick: () => void,
  intervalMs: number,
): ScheduledMaintenance {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return Object.freeze({ cancel: () => clearInterval(timer) });
}

function validateOptions(options: ReliableEventsWorkerRuntimeOptions): void {
  const consumers = options.consumerKeys;
  if (
    options.schemaVersion !== 1 ||
    typeof options.queue?.start !== "function" ||
    typeof options.queue.stop !== "function" ||
    typeof options.queue.publishOutboxDispatch !== "function" ||
    typeof options.processWebhookInbox !== "function" ||
    typeof options.dispatchOutboxEvent !== "function" ||
    typeof options.runWithQueueContext !== "function" ||
    typeof options.listReadyOutboxJobs !== "function" ||
    typeof options.purgeExpiredWebhookPayloads !== "function" ||
    !Array.isArray(consumers) ||
    consumers.some(
      (consumer) => !reliableEventConsumerKeySchema.safeParse(consumer).success,
    ) ||
    new Set(consumers).size !== consumers.length ||
    typeof options.now !== "function" ||
    typeof options.createPropagation !== "function" ||
    !Number.isSafeInteger(options.intervalMs) ||
    options.intervalMs < 1_000 ||
    options.intervalMs > 86_400_000 ||
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 1_000 ||
    (options.schedule !== undefined &&
      typeof options.schedule !== "function") ||
    (options.onNotice !== undefined && typeof options.onNotice !== "function")
  ) {
    throw new ReliableEventsWorkerRuntimeError("INVALID_CONFIGURATION");
  }
}

export function createReliableEventsWorkerRuntime(
  options: ReliableEventsWorkerRuntimeOptions,
): ReliableEventsWorkerRuntime {
  validateOptions(options);
  const consumerKeys = Object.freeze([...options.consumerKeys]);
  const schedule = options.schedule ?? defaultSchedule;
  let lifecycle: "NEW" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" =
    "NEW";
  let scheduled: ScheduledMaintenance | undefined;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let maintenancePromise: Promise<void> | undefined;

  const emitNotice = (code: ReliableEventsWorkerNotice["code"]): void => {
    try {
      void Promise.resolve(
        options.onNotice?.(
          Object.freeze({ schemaVersion: 1, severity: "WARNING", code }),
        ),
      ).catch(() => undefined);
    } catch {
      // Observability is best-effort and never receives provider data.
    }
  };

  const relayReadyOutbox = async (
    availableAtOrBefore: string,
    propagation: QueuePropagationCarrier,
  ): Promise<void> => {
    for (const consumerKey of consumerKeys) {
      try {
        const jobs = await options.listReadyOutboxJobs({
          schemaVersion: 1,
          operation: "LIST_READY_OUTBOX_EVENTS",
          consumerKey,
          availableAtOrBefore,
          limit: options.batchSize,
          propagation,
        });
        for (const job of jobs) {
          await options.queue.publishOutboxDispatch(job);
        }
      } catch {
        emitNotice("OUTBOX_RELAY_FAILED");
      }
    }
  };

  const purgeExpiredPayloads = async (now: string): Promise<void> => {
    try {
      await options.purgeExpiredWebhookPayloads({
        schemaVersion: 1,
        operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
        expiredAtOrBefore: now,
        purgedAt: now,
        limit: options.batchSize,
      });
    } catch {
      emitNotice("PAYLOAD_PURGE_FAILED");
    }
  };

  const runMaintenancePass = async (): Promise<void> => {
    let now: string;
    try {
      const parsedNow = portTimestampSchema.safeParse(options.now());
      if (!parsedNow.success) {
        emitNotice("MAINTENANCE_CONTEXT_UNAVAILABLE");
        return;
      }
      now = parsedNow.data;
    } catch {
      emitNotice("MAINTENANCE_CONTEXT_UNAVAILABLE");
      return;
    }

    let propagation: QueuePropagationCarrier | undefined;
    try {
      propagation = options.createPropagation();
    } catch {
      propagation = undefined;
    }
    if (propagation === undefined) {
      emitNotice("MAINTENANCE_CONTEXT_UNAVAILABLE");
    } else {
      await relayReadyOutbox(now, propagation);
    }
    await purgeExpiredPayloads(now);
  };

  const runMaintenanceOnce = (): Promise<void> => {
    if (lifecycle !== "RUNNING" && lifecycle !== "STOPPING") {
      return Promise.resolve();
    }
    maintenancePromise ??= runMaintenancePass().finally(() => {
      maintenancePromise = undefined;
    });
    return maintenancePromise;
  };

  const start = (): Promise<void> => {
    if (startPromise !== undefined) {
      return startPromise;
    }
    if (lifecycle !== "NEW") {
      return Promise.reject(
        new ReliableEventsWorkerRuntimeError("START_FAILED"),
      );
    }
    lifecycle = "STARTING";
    startPromise = (async () => {
      try {
        await options.queue.start({
          processWebhookInbox: (job, context) =>
            options.runWithQueueContext(job, () =>
              options.processWebhookInbox(job, context),
            ),
          dispatchOutboxEvent: (job, context) =>
            options.runWithQueueContext(job, () =>
              options.dispatchOutboxEvent(job, context),
            ),
        });
        scheduled = schedule(() => {
          void runMaintenanceOnce();
        }, options.intervalMs);
        lifecycle = "RUNNING";
      } catch {
        lifecycle = "STOPPED";
        try {
          await options.queue.stop();
        } catch {
          // Startup failure remains authoritative.
        }
        throw new ReliableEventsWorkerRuntimeError("START_FAILED");
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
      lifecycle = "STOPPING";
      try {
        scheduled?.cancel();
        await maintenancePromise;
        await options.queue.stop();
        lifecycle = "STOPPED";
      } catch {
        lifecycle = "STOPPED";
        throw new ReliableEventsWorkerRuntimeError("STOP_FAILED");
      }
    })();
    return stopPromise;
  };

  return Object.freeze({ start, stop, runMaintenanceOnce });
}
