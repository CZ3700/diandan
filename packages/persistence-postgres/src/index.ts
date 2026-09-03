export const workspacePackageName =
  "@fan-support/persistence-postgres" as const;

export type {
  PostgresConnectionConfig,
  PostgresTlsConfig,
} from "./connection-config.js";
export {
  createPostgresPersistence,
  type PersistenceFailureNotice,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "./postgres-persistence.js";
export {
  createReliableEventRepositories,
  type ReliableEventRepositoryDependencies,
  type ReliableEventRepositorySet,
  type WebhookInboxPublisher,
} from "./reliable-event-repositories.js";
export {
  createPgBossReliableEventQueue,
  PgBossReliableEventQueueError,
  RELIABLE_EVENT_QUEUE_NAMES,
  type PgBossReliableEventQueue,
  type PgBossReliableEventQueueErrorCode,
  type PgBossReliableEventQueueOptions,
  type ReliableEventQueueExecutionContext,
  type ReliableEventQueueHandlers,
  type ReliableEventQueueInfrastructureNotice,
  type ReliableEventQueueTransaction,
} from "./pg-boss-queue.js";
export {
  assertCatalogMatches,
  captureDatabaseCatalog,
  DatabaseCatalogError,
  parseDatabaseCatalogSnapshot,
  type DatabaseCatalogSnapshot,
} from "./migrations/catalog.js";
export {
  generateMigrationManifest,
  type GeneratedMigrationManifest,
} from "./migrations/manifest-generation.js";
export {
  loadMigrationManifest,
  type LoadedMigration,
  MigrationManifestError,
  type MigrationSource,
} from "./migrations/manifest.js";
export {
  type MigrationCommand,
  type MigrationCommandResult,
  MigrationExecutionError,
  runMigrations,
} from "./migrations/runner.js";
export {
  type DockerCommandExecutor,
  EphemeralPostgresError,
  withEphemeralPostgres,
} from "./testing/ephemeral-postgres.js";
