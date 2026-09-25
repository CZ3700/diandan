export { createAdminPaymentConfigurationRepository } from "./admin-payment-configuration-repository.js";
export { createAdminFinanceRepository } from "./admin-finance-repository.js";
export { createPaymentHealthRepository } from "./payment-health-repository.js";
export { createAdminOrdersRepository } from "./admin-orders-repository.js";
export { createAdminOrderResendRepository } from "./admin-notification-resend-repository.js";
export { createAdminOrderResendNotificationRepository } from "./admin-notification-resend-worker.js";
export { createCheckoutPreflightRepository } from "./checkout-preflight-repository.js";
export * from "./translation-workspace-repository.js";
export * from "./translation-transfer-repository.js";
export * from "./admin-preview-media-repository.js";
export * from "./admin-session-repository.js";
export * from "./admin-catalog-repository.js";
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
  type TestPostgresRuntimeMetadata,
  EphemeralPostgresError,
  withEphemeralPostgres,
} from "./testing/ephemeral-postgres.js";
export {
  withNativeTestPostgres,
  type NativePostgresMetadata,
  type NativePostgresOptions,
  type NativePostgresRun,
} from "./testing/native-postgres.js";
export { rebuildIdolSearchProjections } from "./catalog-search-projection.js";
export { createCatalogDirectoryRepository } from "./catalog-directory-repository.js";
export { createManagementCenterOperationRepository } from "./management-center-operation-repository.js";
export { createDailyPublicationRepository } from "./daily-publication-repository.js";
