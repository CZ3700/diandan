import { createPublicationAuthorizationRepository } from "./publication-authorization-repository.js";
import { createPublicationRuntimeRepository } from "./publication-runtime-repository.js";
import { createPublicationPurgeRepository } from "./publication-purge-repository.js";
import { createPublishedContentRepository } from "./published-content-repository.js";
import type {
  PublicationRuntimeTransactionManager,
  PublicationRuntimeRepositories,
  PublicationPurgeTransactionManager,
  PublicationPurgeRepositories,
  PublishedContentTransactionManager,
  PublishedContentRepositories,
} from "@fan-support/persistence-port";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import { createResourceManagementRepository } from "./resource-management-repository.js";
import { createResourceAuthorizationRepository } from "./resource-authorization-repository.js";
import { createBaseContentReviewRepository } from "./base-content-review-repository.js";
import { createBaseContentPreviewRepository } from "./base-content-preview-repository.js";
import { createAdminAuthorizationRepository } from "./admin-authorization-repository.js";
import { createContentReviewRepository } from "./content-review-repository.js";
import { createContentPreviewRepository } from "./content-preview-repository.js";
import { createMediaProcessingRepository } from "./media-processing-repository.js";
import { createContentDraftRepository } from "./content-draft-repository.js";
import { publicMediaUrlSchema } from "@fan-support/contracts";
import { createCatalogDirectoryRepository } from "./catalog-directory-repository.js";
import type {
  JsonValue,
  PublicationPreflightTransactionManager,
  PublicationPreflightRepositories,
  ResourceManagementTransactionManager,
  ResourceManagementRepositories,
  BaseContentTransactionManager,
  BaseContentRepositories,
  ContentAuthoringTransactionManager,
  ContentAuthoringRepositories,
  AdminContentTransactionManager,
  AdminContentRepositories,
  ContentDraftTransactionManager,
  ContentDraftRepositories,
  MediaProcessingTransactionManager,
  MediaProcessingRepositories,
  ContentReadTransactionManager,
  ContentReadRepositories,
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
  readonly publicationRuntimeTransactionManager: PublicationRuntimeTransactionManager;
  readonly publicationPurgeTransactionManager: PublicationPurgeTransactionManager;
  readonly publishedContentTransactionManager: PublishedContentTransactionManager;
  readonly publicationPreflightTransactionManager: PublicationPreflightTransactionManager;
  readonly resourceManagementTransactionManager: ResourceManagementTransactionManager;
  readonly baseContentTransactionManager: BaseContentTransactionManager;
  readonly contentAuthoringTransactionManager: ContentAuthoringTransactionManager;
  readonly adminContentTransactionManager: AdminContentTransactionManager;
  readonly contentDraftTransactionManager: ContentDraftTransactionManager;
  readonly mediaProcessingTransactionManager: MediaProcessingTransactionManager;
  readonly transactionManager: TransactionManager;
  readonly contentReadTransactionManager: ContentReadTransactionManager;
  readonly reliableEventTransactionManager: ReliableEventTransactionManager;
  close(): Promise<void>;
}

export type PersistenceFailureNotice = PersistenceFailureClassification;

export type PostgresPersistenceOptions = Readonly<{
  onInfrastructureFailure?: (
    failure: PersistenceFailureNotice,
  ) => void | Promise<void>;
  publishWebhookInbox?: WebhookInboxPublisher;
  catalogPublicMediaBaseUrl?: string;
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

function isCatalogMediaOrigin(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !publicMediaUrlSchema.safeParse(value).success
  )
    return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
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
        key === "onInfrastructureFailure" ||
        key === "publishWebhookInbox" ||
        key === "catalogPublicMediaBaseUrl",
    ) &&
    (record["onInfrastructureFailure"] === undefined ||
      typeof record["onInfrastructureFailure"] === "function") &&
    (record["catalogPublicMediaBaseUrl"] === undefined ||
      isCatalogMediaOrigin(record["catalogPublicMediaBaseUrl"])) &&
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
  const contentReadRunner = createTransactionRunner<ContentReadRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => ({
      catalogDirectory: createCatalogDirectoryRepository(client, {
        transactionScope,
        publicMediaBaseUrl: options!.catalogPublicMediaBaseUrl!,
      }),
    }),
  });
  const mediaProcessingRunner =
    createTransactionRunner<MediaProcessingRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, transactionScope) => ({
        mediaProcessing: createMediaProcessingRepository(
          client,
          transactionScope,
        ),
      }),
    });
  const contentDraftRunner = createTransactionRunner<ContentDraftRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, transactionScope) => ({
      contentDrafts: createContentDraftRepository(client, transactionScope),
    }),
  });
  const adminContentRunner = createTransactionRunner<AdminContentRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createAdminAuthorizationRepository(client, scope),
      contentDrafts: createContentDraftRepository(client, scope),
      contentReviews: createContentReviewRepository(client, scope),
      contentPreviews: createContentPreviewRepository(client, scope),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const contentAuthoringRunner =
    createTransactionRunner<ContentAuthoringRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        contentAuthoring: createContentAuthoringRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const publicationRuntimeRunner =
    createTransactionRunner<PublicationRuntimeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createPublicationAuthorizationRepository(client, scope),
        publicationRuntime: createPublicationRuntimeRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
    });
  const publicationPurgeRunner =
    createTransactionRunner<PublicationPurgeRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        publicationPurge: createPublicationPurgeRepository(client, scope),
      }),
    });
  const publishedContentRunner =
    createTransactionRunner<PublishedContentRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        publishedContent: createPublishedContentRepository(
          client,
          scope,
          options?.catalogPublicMediaBaseUrl ?? "",
        ),
      }),
    });
  const publicationPreflightRunner =
    createTransactionRunner<PublicationPreflightRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createAdminAuthorizationRepository(client, scope),
        publicationPreflight: createPublicationPreflightRepository(
          client,
          scope,
        ),
      }),
    });
  const baseContentRunner = createTransactionRunner<BaseContentRepositories>({
    acquireClient: async () => pool.connect(),
    createRepositories: (client, scope) => ({
      authorization: createAdminAuthorizationRepository(client, scope),
      baseContentReviews: createBaseContentReviewRepository(client, scope),
      baseContentPreviews: createBaseContentPreviewRepository(client, scope),
      idempotency: createIdempotencyRepository(
        createPostgresQueryLayer(client as NodePgClient),
        scope,
      ),
    }),
  });
  const resourceManagementRunner =
    createTransactionRunner<ResourceManagementRepositories>({
      acquireClient: async () => pool.connect(),
      createRepositories: (client, scope) => ({
        authorization: createResourceAuthorizationRepository(client, scope),
        resources: createResourceManagementRepository(client, scope),
        idempotency: createIdempotencyRepository(
          createPostgresQueryLayer(client as NodePgClient),
          scope,
        ),
      }),
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

  const contentReadTransactionManager: ContentReadTransactionManager = {
    async runInContentReadTransaction<Result extends JsonValue>(
      work: (repositories: ContentReadRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (
        lifecycle !== "OPEN" ||
        options?.catalogPublicMediaBaseUrl === undefined
      ) {
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      }
      return contentReadRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };

  const mediaProcessingTransactionManager: MediaProcessingTransactionManager = {
    async runInMediaProcessingTransaction<Result extends JsonValue>(
      work: (repositories: MediaProcessingRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return mediaProcessingRunner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        work,
      );
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

  const contentDraftTransactionManager: ContentDraftTransactionManager = {
    async runInContentDraftTransaction<Result extends JsonValue>(
      work: (repositories: ContentDraftRepositories) => Promise<Result>,
    ): Promise<Result> {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return contentDraftRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };

  const adminContentTransactionManager: AdminContentTransactionManager = {
    async runInAdminContentTransaction(work) {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return adminContentRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };
  const contentAuthoringTransactionManager: ContentAuthoringTransactionManager =
    {
      async runInContentAuthoringTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return contentAuthoringRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    };
  const baseContentTransactionManager: BaseContentTransactionManager = {
    async runInBaseContentTransaction(work) {
      if (lifecycle !== "OPEN")
        throw createPersistenceTransactionFailureError({
          code: "CONFIGURATION_ERROR",
          recovery: "NONE",
        });
      return baseContentRunner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        work,
      );
    },
  };
  return {
    publicationRuntimeTransactionManager: {
      async runInPublicationRuntimeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationRuntimeRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publicationPurgeTransactionManager: {
      async runInPublicationPurgeTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationPurgeRunner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        );
      },
    },
    publishedContentTransactionManager: {
      async runInPublishedContentTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        if (options?.catalogPublicMediaBaseUrl === undefined)
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publishedContentRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    publicationPreflightTransactionManager: {
      async runInPublicationPreflightTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return publicationPreflightRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    resourceManagementTransactionManager: {
      async runInResourceManagementTransaction(work) {
        if (lifecycle !== "OPEN")
          throw createPersistenceTransactionFailureError({
            code: "CONFIGURATION_ERROR",
            recovery: "NONE",
          });
        return resourceManagementRunner.run(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          work,
        );
      },
    },
    baseContentTransactionManager,
    contentAuthoringTransactionManager,
    adminContentTransactionManager,
    transactionManager,
    reliableEventTransactionManager,
    contentReadTransactionManager,
    mediaProcessingTransactionManager,
    contentDraftTransactionManager,
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
