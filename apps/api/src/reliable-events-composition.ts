import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import {
  createPaymentWebhookEndpointPreflight,
  createReceivePaymentWebhook,
  type ReceivePaymentWebhookDependencies,
} from "@fan-support/application";
import { resolveDatabaseRuntimeConfig } from "@fan-support/config/server";
import type { StructuredLogger } from "@fan-support/observability";
import {
  createPgBossReliableEventQueue,
  createPostgresPersistence,
  type PgBossReliableEventQueue,
  type PgBossReliableEventQueueOptions,
  type PersistenceFailureNotice,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
  type ReliableEventQueueInfrastructureNotice,
} from "@fan-support/persistence-postgres";

import type { ApiLifecycleResource } from "./bootstrap.js";
import type { PaymentWebhookRouteOptions } from "./payment-webhook-route.js";

const QUEUE_SCHEMA = "pgboss";
const API_DATABASE_APPLICATION_NAME = "fan-support-api";

type ApiReliableEventQueue = Pick<
  PgBossReliableEventQueue,
  "publishWebhookInbox" | "start" | "stop"
>;

type ApiReliableEventPersistence = Readonly<{
  reliableEventTransactionManager: ReceivePaymentWebhookDependencies["transactionManager"];
  close(): Promise<void>;
}>;

type QueueFactory = (
  options: PgBossReliableEventQueueOptions,
) => ApiReliableEventQueue;

type PersistenceFactory = (
  config: PostgresConnectionConfig,
  options: PostgresPersistenceOptions,
) => ApiReliableEventPersistence;

export type ApiReliableEventsCompositionOptions = Readonly<{
  logger: StructuredLogger;
  verifierForEndpoint?: ReceivePaymentWebhookDependencies["verifierForEndpoint"];
  keyManagement?: ReceivePaymentWebhookDependencies["keyManagement"];
  createId?: ReceivePaymentWebhookDependencies["createId"];
  factories?: Readonly<{
    createQueue?: QueueFactory;
    createPersistence?: PersistenceFactory;
  }>;
}>;

export type ApiReliableEventsComposition = Readonly<{
  paymentWebhookRoute: PaymentWebhookRouteOptions;
  reliableEventsRuntime: ApiLifecycleResource;
}>;

const unavailableKeyManagement: ReceivePaymentWebhookDependencies["keyManagement"] =
  Object.freeze({
    encryptEnvelope: async () =>
      Object.freeze({
        schemaVersion: 1 as const,
        operation: "ENCRYPT_ENVELOPE" as const,
        outcome: "FAILURE" as const,
        error: Object.freeze({
          schemaVersion: 1 as const,
          code: "CONFIGURATION_ERROR" as const,
          recovery: "NONE" as const,
        }),
      }),
  });

function reportQueueNotice(
  logger: StructuredLogger,
  notice: ReliableEventQueueInfrastructureNotice,
): void {
  const fields = Object.freeze({
    errorCode: notice.code,
    outcome: "failure" as const,
  });
  if (notice.severity === "WARNING") {
    logger.warn("reliable_events.queue_notice", fields);
    return;
  }
  logger.error("reliable_events.queue_notice", fields);
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

async function sha256DecodedRawBody(rawBodyBase64: string): Promise<string> {
  return createHash("sha256")
    .update(Buffer.from(rawBodyBase64, "base64url"))
    .digest("hex");
}

function createLifecycle(
  queue: ApiReliableEventQueue,
  persistence: ApiReliableEventPersistence,
): ApiLifecycleResource {
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  return Object.freeze({
    start: () => {
      startPromise ??= Promise.resolve().then(() => queue.start());
      return startPromise;
    },
    stop: () => {
      stopPromise ??= (async () => {
        await startPromise?.catch(() => undefined);
        let failed = false;
        try {
          await persistence.close();
        } catch {
          failed = true;
        }
        try {
          await queue.stop();
        } catch {
          failed = true;
        }
        if (failed) {
          throw new Error("API reliable events failed to stop");
        }
      })();
      return stopPromise;
    },
  });
}

export function createApiReliableEventsComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: ApiReliableEventsCompositionOptions,
): ApiReliableEventsComposition {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const createQueue =
    options.factories?.createQueue ?? createPgBossReliableEventQueue;
  const createPersistence =
    options.factories?.createPersistence ?? createPostgresPersistence;
  const queue = createQueue({
    schemaVersion: 1,
    connectionString: database.url,
    schema: QUEUE_SCHEMA,
    managementMode: "VERIFY",
    localConcurrency: 1,
    onInfrastructureNotice: (notice) =>
      reportQueueNotice(options.logger, notice),
  });
  const persistence = createPersistence(
    {
      connectionString: database.url,
      application_name: API_DATABASE_APPLICATION_NAME,
    },
    {
      publishWebhookInbox: queue.publishWebhookInbox,
      onInfrastructureFailure: (failure) =>
        reportPersistenceFailure(options.logger, failure),
    },
  );
  const transactionManager = persistence.reliableEventTransactionManager;
  const receive = createReceivePaymentWebhook({
    transactionManager,
    verifierForEndpoint: options.verifierForEndpoint ?? (() => undefined),
    keyManagement: options.keyManagement ?? unavailableKeyManagement,
    createId: options.createId ?? randomUUID,
    sha256Hex: sha256DecodedRawBody,
  });

  return Object.freeze({
    paymentWebhookRoute: Object.freeze({
      receiver: Object.freeze({ receive }),
      endpointPreflight: createPaymentWebhookEndpointPreflight({
        transactionManager,
      }),
    }),
    reliableEventsRuntime: createLifecycle(queue, persistence),
  });
}
