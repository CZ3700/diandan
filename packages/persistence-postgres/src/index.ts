export const workspacePackageName =
  "@fan-support/persistence-postgres" as const;

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
