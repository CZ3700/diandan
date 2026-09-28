import { randomBytes, randomUUID } from "node:crypto";

import {
  createDispatchOutboxEvent,
  createOrderPaymentApplication,
  createCommerceExpiryUseCases,
  createOrderPaymentWebhookHandler,
  createAdminFinanceWebhookHandler,
  createAdminFinanceEventApplication,
  createAdminExceptionsRecovery,
  createListReadyOutboxJobs,
  createProcessWebhookInbox,
  createPurgeExpiredWebhookPayloads,
  type DispatchOutboxEventDependencies,
  type ProcessWebhookInboxDependencies,
} from "@fan-support/application";
import { resolveDatabaseRuntimeConfig } from "@fan-support/config/server";
import {
  queuePropagationCarrierSchema,
  type OutboxDispatchJob,
  type QueuePropagationCarrier,
  type WebhookInboxJob,
} from "@fan-support/contracts";
import {
  parseQueuePropagationCarrier,
  type StructuredLogger,
} from "@fan-support/observability";
import { runWithServerRequest } from "@fan-support/observability/node";
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
import { prepareOptionalWorkerNotifications } from "./notification-composition.js";
import {
  informationPagePublicationConsumer,
  informationPagePublicationConsumerKey,
} from "./information-page-publication.js";

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
  prepareNotifications: typeof prepareOptionalWorkerNotifications;
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
  public constructor(
    public readonly code: "INVALID_PROPAGATION" | "STOP_FAILED",
  ) {
    super("Worker reliable-events composition failed");
    this.name = "WorkerReliableEventsCompositionError";
  }
}

const discardLogger: StructuredLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

function runWithObservedQueueContext(
  job: WebhookInboxJob | OutboxDispatchJob,
  logger: StructuredLogger,
  handler: () => Promise<void>,
): Promise<void> {
  let headers: Readonly<Record<string, string>> | undefined;
  try {
    headers = parseQueuePropagationCarrier(job.propagation);
  } catch {
    headers = undefined;
  }
  if (headers === undefined) {
    return Promise.reject(
      new WorkerReliableEventsCompositionError("INVALID_PROPAGATION"),
    );
  }

  const route =
    job.jobType === "PROCESS_WEBHOOK_INBOX"
      ? "/jobs/payment-webhook-inbox"
      : "/jobs/outbox-dispatch";
  return runWithServerRequest(
    {
      service: "worker",
      method: "POST",
      route,
      headers,
      logger,
    },
    handler,
  );
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
  handlerForEvent: (eventType) =>
    eventType === "PAYMENT_STATUS"
      ? createOrderPaymentWebhookHandler()
      : eventType === "REFUND_STATUS" || eventType === "DISPUTE_STATUS"
        ? createAdminFinanceWebhookHandler()
        : undefined,
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
    prepareNotifications: prepareOptionalWorkerNotifications,
  });

export function createWorkerReliableEventsComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: WorkerReliableEventsCompositionOptions = {},
): WorkerReliableEventsComposition {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const logger = options.logger;
  const contextLogger = logger ?? discardLogger;
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
    prepareNotifications:
      suppliedFactories?.prepareNotifications ??
      defaultFactories.prepareNotifications,
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

  // Validate mail configuration and approvals before allocating infrastructure.
  const bindNotifications = factories.prepareNotifications(environment);
  const notificationConsumerKey = "order-notifications-v1";
  if (bindings.consumerKeys.includes(informationPagePublicationConsumerKey))
    throw new TypeError("Reserved information publication consumer key");
  if (
    bindNotifications &&
    bindings.consumerKeys.includes(notificationConsumerKey)
  ) {
    throw new TypeError("Reserved notification consumer key");
  }
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
  const notifications = bindNotifications?.({
    notificationTransactionManager: persistence.notificationTransactionManager,
    notificationSubmissionTransactionManager:
      persistence.notificationSubmissionTransactionManager,
    adminOrderResendNotificationTransactionManager:
      persistence.adminOrderResendNotificationTransactionManager,
    ...(logger ? { logger } : {}),
  });
  const expiry = createCommerceExpiryUseCases({
    transactions: persistence.commerceExpiryTransactionManager,
    createId: factories.createId,
  });
  const orderPayments = createOrderPaymentApplication({
    transactions: persistence.orderPaymentApplicationTransactionManager,
    createId: factories.createId,
  });
  const finance = createAdminFinanceEventApplication(
    persistence.adminFinanceTransactionManager,
  );
  const processWebhookInbox = createProcessWebhookInbox({
    transactionManager,
    handlerForEvent: bindings.handlerForEvent,
    createId: factories.createId,
    now: factories.now,
  });
  const dispatchOutboxEvent = createDispatchOutboxEvent({
    transactionManager,
    consumerForKey: (key) =>
      key === informationPagePublicationConsumerKey
        ? informationPagePublicationConsumer
        : notifications && key === notificationConsumerKey
          ? notifications.consumer
          : bindings.consumerForKey(key),
    createId: factories.createId,
    now: factories.now,
  });
  const exceptions = createAdminExceptionsRecovery({
    transactions: persistence.adminExceptionsTransactionManager,
    processWebhookInbox: (job, delivery) =>
      runWithObservedQueueContext(job, contextLogger, () =>
        processWebhookInbox(job, delivery),
      ),
    dispatchOutboxEvent: (job, delivery) =>
      runWithObservedQueueContext(job, contextLogger, () =>
        dispatchOutboxEvent(job, delivery),
      ),
  });
  const runtime: ReliableEventsWorkerRuntime = factories.createRuntime({
    schemaVersion: 1,
    queue,
    processWebhookInbox,
    dispatchOutboxEvent,
    runPendingExceptions: async () => {
      const result = await exceptions.runPending(6);
      if (result.failed > 0) throw new Error("Exception recovery failed");
    },
    runWithQueueContext: (job, handler) =>
      runWithObservedQueueContext(job, contextLogger, handler),
    listReadyOutboxJobs: createListReadyOutboxJobs({ transactionManager }),
    purgeExpiredWebhookPayloads: createPurgeExpiredWebhookPayloads({
      transactionManager,
    }),
    applyPendingOrderPayments: async () => {
      const result = await orderPayments.runPending(MAINTENANCE_BATCH_SIZE);
      if (result.failed > 0)
        throw new Error("Order payment maintenance failed");
      if (result.review > 0)
        contextLogger.warn("order_payment.review_required", {
          outcome: "failure",
          errorCode: "PAYMENT_REVIEW_REQUIRED",
        });
    },
    applyPendingFinance: async () => {
      const result = await finance.runPending(MAINTENANCE_BATCH_SIZE);
      if (result.failed > 0) throw new Error("Finance maintenance failed");
      if (result.review > 0)
        contextLogger.warn("admin_finance.review_required", {
          outcome: "failure",
          errorCode: "FINANCE_REVIEW_REQUIRED",
        });
    },
    ...(notifications
      ? {
          runPendingNotifications: async () => {
            const result = await notifications.runPending(
              MAINTENANCE_BATCH_SIZE,
            );
            if (result.failed > 0)
              throw new Error("Notification maintenance failed");
          },
        }
      : {}),
    expireCommerceResources: async () => {
      const result = await expiry.runPending(MAINTENANCE_BATCH_SIZE);
      if (result.failed > 0) throw new Error("Commerce expiry failed");
    },
    consumerKeys: [
      ...bindings.consumerKeys,
      informationPagePublicationConsumerKey,
      ...(notifications ? [notificationConsumerKey] : []),
    ],
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
