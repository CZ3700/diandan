import type {
  JsonValue,
  ReliableEventTransactionManager,
  ReliableEventTransactionRepositories,
  TransactionOptions,
  TransactionManager,
  TransactionRepositories,
} from "@fan-support/persistence-port";
import { transactionOptionsSchema } from "@fan-support/persistence-port";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import {
  normalizePostgresConnectionConfig,
  type NormalizedPostgresConnectionConfig,
  type PostgresConnectionConfig,
} from "./connection-config.js";
import { createIdempotencyRepository } from "./idempotency-repository.js";
import { createInventoryRepository } from "./inventory-repository.js";
import { createOutboxRepository } from "./outbox-repository.js";
import { createPostgresQueryLayer } from "./query-layer.js";
import {
  createReliableEventRepositories,
  type WebhookInboxPublisher,
} from "./reliable-event-repositories.js";
import {
  createPersistenceTransactionFailureError,
  createTransactionRunner,
  type TransactionClient,
} from "./transaction-runner.js";
import {
  classifyPostgresFailure,
  type PersistenceFailureClassification,
} from "./errors.js";

export interface PostgresPersistence {
  readonly transactionManager: TransactionManager;
  readonly reliableEventTransactionManager: ReliableEventTransactionManager;
  close(): Promise<void>;
}

export type PersistenceFailureNotice = PersistenceFailureClassification;

export type PostgresPersistenceOptions = Readonly<{
  onInfrastructureFailure?: (
    failure: PersistenceFailureNotice,
  ) => void | Promise<void>;
  publishWebhookInbox?: WebhookInboxPublisher;
}>;

export interface ManagedPersistencePool {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
  on(event: "error", listener: (failure: unknown) => void): void;
  off(event: "error", listener: (failure: unknown) => void): void;
}

type PersistencePoolFactory = (
  config: NormalizedPostgresConnectionConfig,
) => ManagedPersistencePool;

function createNodePostgresPool(
  config: NormalizedPostgresConnectionConfig,
): ManagedPersistencePool {
  const pool = new Pool(config as PoolConfig);
  return {
    connect: async () => (await pool.connect()) as TransactionClient,
    end: () => pool.end(),
    on: (_event, listener) => {
      pool.on("error", listener);
    },
    off: (_event, listener) => {
      pool.off("error", listener);
    },
  };
}

function isPersistenceOptions(
  value: unknown,
): value is PostgresPersistenceOptions | undefined {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    Object.keys(record).every(
      (key) =>
        key === "onInfrastructureFailure" || key === "publishWebhookInbox",
    ) &&
    (record["onInfrastructureFailure"] === undefined ||
      typeof record["onInfrastructureFailure"] === "function") &&
    (record["publishWebhookInbox"] === undefined ||
      typeof record["publishWebhookInbox"] === "function")
  );
}

export function createPostgresPersistenceWithPoolFactory(
  config: PostgresConnectionConfig,
  options: PostgresPersistenceOptions | undefined,
  poolFactory: PersistencePoolFactory,
): PostgresPersistence {
  const normalizedConfig = normalizePostgresConnectionConfig(config);
  if (normalizedConfig === undefined || !isPersistenceOptions(options)) {
    throw createPersistenceTransactionFailureError({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
  }
  let pool: ManagedPersistencePool;
  try {
    pool = poolFactory(normalizedConfig);
  } catch {
    throw createPersistenceTransactionFailureError({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
  }

  const handlePoolFailure = (error: unknown): void => {
    const failure = Object.freeze({ ...classifyPostgresFailure(error) });
    try {
      void Promise.resolve(options?.onInfrastructureFailure?.(failure)).catch(
        () => {
          // Asynchronous observer rejection is contained for the same reason.
        },
      );
    } catch {
      // An observer cannot turn an already-consumed pool failure into a crash.
    }
  };
  pool.on("error", handlePoolFailure);

  const runner = createTransactionRunner<TransactionRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => {
      const database = createPostgresQueryLayer(client as NodePgClient);
      return {
        idempotency: createIdempotencyRepository(database, transactionScope),
        outbox: createOutboxRepository(database, transactionScope),
        inventory: createInventoryRepository(database, transactionScope),
      };
    },
  });
  const publishWebhookInbox: WebhookInboxPublisher =
    options?.publishWebhookInbox ??
    (async () => {
      throw createPersistenceTransactionFailureError({
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      });
    });
  const reliableEventRunner =
    createTransactionRunner<ReliableEventTransactionRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, transactionScope) => {
        const database = createPostgresQueryLayer(client as NodePgClient);
        return {
          ...createReliableEventRepositories(client, {
            transactionScope,
            publishWebhookInbox,
          }),
          outbox: createOutboxRepository(database, transactionScope),
        };
      },
    });
  let lifecycle: "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  let closePromise: Promise<void> | undefined;

  const transactionManager: TransactionManager = {
    async runInTransaction<Result extends JsonValue>(
      options: TransactionOptions,
      work: (repositories: TransactionRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN") {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      const parsedOptions = transactionOptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        throw createPersistenceTransactionFailureError({
          code: "INVALID_COMMAND",
          recovery: "NONE",
        });
      }
      return runner.run(parsedOptions.data, work);
    },
  };

  const reliableEventTransactionManager: ReliableEventTransactionManager = {
    async runInReliableEventTransaction<Result extends JsonValue>(
      options: TransactionOptions,
      work: (
        repositories: ReliableEventTransactionRepositories,
      ) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN") {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      const parsedOptions = transactionOptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        throw createPersistenceTransactionFailureError({
          code: "INVALID_COMMAND",
          recovery: "NONE",
        });
      }
      return reliableEventRunner.run(parsedOptions.data, work);
    },
  };

  const close = (): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise;
    }
    lifecycle = "CLOSING";
    let endResult: Promise<void>;
    try {
      endResult = pool.end();
    } catch (error: unknown) {
      endResult = Promise.reject(error);
    }
    closePromise = endResult.then(
      () => {
        lifecycle = "CLOSED";
        try {
          pool.off("error", handlePoolFailure);
        } catch {
          // Listener cleanup cannot expose a provider-specific close failure.
        }
      },
      () => {
        lifecycle = "CLOSED";
        // A failed shutdown leaves this instance unusable. Keep consuming idle
        // pool errors, and require callers to construct a fresh adapter.
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      },
    );
    return closePromise;
  };

  return {
    transactionManager,
    reliableEventTransactionManager,
    close,
  };
}

export function createPostgresPersistence(
  config: PostgresConnectionConfig,
  options?: PostgresPersistenceOptions,
): PostgresPersistence {
  return createPostgresPersistenceWithPoolFactory(
    config,
    options,
    createNodePostgresPool,
  );
}
