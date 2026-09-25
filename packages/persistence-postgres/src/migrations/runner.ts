import { Client } from "pg";

import {
  normalizePostgresConnectionConfig,
  type PostgresConnectionConfig,
} from "../connection-config.js";
import { loadMigrationManifest, type LoadedMigration } from "./manifest.js";

const migrationLockNamespace = "fan-support-platform:migrations:v1";
const migrationLockWaitMilliseconds = 15_000;
const initialMigrationLockBackoffMilliseconds = 25;
const maximumMigrationLockBackoffMilliseconds = 500;
const migrationVersionPattern = /^\d{4}$/u;

const createHistoryTableSql = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version varchar(4) PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  name varchar(120) NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]*$'),
  up_sha256 char(64) NOT NULL CHECK (up_sha256 ~ '^[a-f0-9]{64}$'),
  down_sha256 char(64) NOT NULL CHECK (down_sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`.trim();

const readHistorySql = `
SELECT version, name, up_sha256, down_sha256
FROM public.schema_migrations
ORDER BY version
`.trim();

type AppliedMigration = Readonly<{
  version: string;
  name: string;
  upSha256: string;
  downSha256: string;
}>;

export type MigrationCommand =
  | Readonly<{ direction: "up"; targetVersion?: string }>
  | Readonly<{ direction: "down"; confirmVersion: string }>;

export type MigrationCommandResult = Readonly<{
  schemaVersion: 1;
  direction: "up" | "down";
  appliedVersions: readonly string[];
  revertedVersions: readonly string[];
  currentVersion: string | null;
}>;

export interface MigrationDatabaseSession {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>>;
}

export class MigrationExecutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MigrationExecutionError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function copyOwnDataRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const output: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return undefined;
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
}

function parseMigrationCommand(value: unknown): MigrationCommand | undefined {
  const record = copyOwnDataRecord(value);
  if (record === undefined) {
    return undefined;
  }
  if (record["direction"] === "up") {
    if (
      (!hasExactKeys(record, ["direction"]) &&
        !hasExactKeys(record, ["direction", "targetVersion"])) ||
      (record["targetVersion"] !== undefined &&
        (typeof record["targetVersion"] !== "string" ||
          !migrationVersionPattern.test(record["targetVersion"])))
    ) {
      return undefined;
    }
    return Object.freeze({
      direction: "up" as const,
      ...(record["targetVersion"] === undefined
        ? {}
        : { targetVersion: record["targetVersion"] as string }),
    });
  }
  if (
    record["direction"] !== "down" ||
    !hasExactKeys(record, ["direction", "confirmVersion"]) ||
    typeof record["confirmVersion"] !== "string" ||
    !migrationVersionPattern.test(record["confirmVersion"])
  ) {
    return undefined;
  }
  return Object.freeze({
    direction: "down" as const,
    confirmVersion: record["confirmVersion"],
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function acquireMigrationLock(
  session: MigrationDatabaseSession,
): Promise<void> {
  let waitedMilliseconds = 0;
  let backoffMilliseconds = initialMigrationLockBackoffMilliseconds;

  while (true) {
    let result: Readonly<{ rows: readonly unknown[] }>;
    try {
      result = await session.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [migrationLockNamespace],
      );
    } catch {
      throw new MigrationExecutionError(
        "could not check migration lock availability",
      );
    }

    const firstRow = result.rows[0];
    if (
      result.rows.length !== 1 ||
      !isRecord(firstRow) ||
      typeof firstRow["locked"] !== "boolean"
    ) {
      throw new MigrationExecutionError(
        "PostgreSQL returned an invalid migration lock result",
      );
    }
    if (firstRow["locked"]) {
      return;
    }
    if (waitedMilliseconds >= migrationLockWaitMilliseconds) {
      throw new MigrationExecutionError(
        `migration lock remained busy for ${migrationLockWaitMilliseconds} ms; another migration may be running`,
      );
    }

    const remainingMilliseconds =
      migrationLockWaitMilliseconds - waitedMilliseconds;
    const nextBackoffMilliseconds = Math.min(
      backoffMilliseconds,
      remainingMilliseconds,
    );
    await wait(nextBackoffMilliseconds);
    waitedMilliseconds += nextBackoffMilliseconds;
    backoffMilliseconds = Math.min(
      backoffMilliseconds * 2,
      maximumMigrationLockBackoffMilliseconds,
    );
  }
}

function parseHistoryRow(value: unknown): AppliedMigration {
  if (!isRecord(value)) {
    throw new MigrationExecutionError(
      "migration history contains an invalid row",
    );
  }
  const version = value["version"];
  const name = value["name"];
  const upSha256 = value["up_sha256"];
  const downSha256 = value["down_sha256"];
  if (
    typeof version !== "string" ||
    typeof name !== "string" ||
    typeof upSha256 !== "string" ||
    typeof downSha256 !== "string"
  ) {
    throw new MigrationExecutionError(
      "migration history contains an invalid row",
    );
  }
  return { version, name, upSha256, downSha256 };
}

function validateAppliedPrefix(
  migrations: readonly LoadedMigration[],
  applied: readonly AppliedMigration[],
): void {
  if (applied.length > migrations.length) {
    throw new MigrationExecutionError(
      "database migration history is not a manifest prefix",
    );
  }

  applied.forEach((row, index) => {
    const expected = migrations[index];
    if (
      expected === undefined ||
      row.version !== expected.version ||
      row.name !== expected.name ||
      row.upSha256 !== expected.up.sha256 ||
      row.downSha256 !== expected.down.sha256
    ) {
      throw new MigrationExecutionError(
        "database migration history is not a manifest prefix",
      );
    }
  });
}

async function readAppliedMigrations(
  session: MigrationDatabaseSession,
): Promise<readonly AppliedMigration[]> {
  let result: Readonly<{ rows: readonly unknown[] }>;
  try {
    result = await session.query(readHistorySql);
  } catch {
    throw new MigrationExecutionError(
      "could not read database migration history",
    );
  }
  return result.rows.map(parseHistoryRow);
}

async function executeTransaction(
  session: MigrationDatabaseSession,
  operation: () => Promise<void>,
  failureMessage: string,
): Promise<void> {
  try {
    await session.query("BEGIN");
  } catch {
    throw new MigrationExecutionError(
      `${failureMessage}: transaction did not start`,
    );
  }

  try {
    await operation();
  } catch {
    try {
      await session.query("ROLLBACK");
    } catch {
      throw new MigrationExecutionError(
        `${failureMessage}: rollback could not be confirmed`,
      );
    }
    throw new MigrationExecutionError(failureMessage);
  }

  let commitResult: Readonly<{
    rows: readonly unknown[];
    command?: string;
  }>;
  try {
    commitResult = await session.query("COMMIT");
  } catch {
    try {
      await session.query("ROLLBACK");
    } catch {
      // A failed COMMIT response is ambiguous regardless of rollback outcome.
    }
    throw new MigrationExecutionError(
      `${failureMessage}: commit outcome is unknown; reconciliation required`,
    );
  }

  if (commitResult.command === "COMMIT") {
    return;
  }
  if (commitResult.command === "ROLLBACK") {
    throw new MigrationExecutionError(
      `${failureMessage}: transaction aborted before commit`,
    );
  }
  throw new MigrationExecutionError(
    `${failureMessage}: commit outcome is unknown; reconciliation required`,
  );
}

async function applyMigration(
  session: MigrationDatabaseSession,
  migration: LoadedMigration,
): Promise<void> {
  await executeTransaction(
    session,
    async () => {
      await session.query(migration.up.sql);
      await session.query(
        `
INSERT INTO public.schema_migrations (
  version,
  name,
  up_sha256,
  down_sha256
)
VALUES ($1, $2, $3, $4)
`.trim(),
        [
          migration.version,
          migration.name,
          migration.up.sha256,
          migration.down.sha256,
        ],
      );
    },
    `migration ${migration.version} up failed`,
  );
}

async function revertMigration(
  session: MigrationDatabaseSession,
  migration: LoadedMigration,
): Promise<void> {
  await executeTransaction(
    session,
    async () => {
      await session.query(migration.down.sql);
      const result = await session.query(
        "DELETE FROM public.schema_migrations WHERE version = $1 RETURNING version",
        [migration.version],
      );
      if (result.rows.length !== 1) {
        throw new MigrationExecutionError(
          `migration ${migration.version} history row was not removed`,
        );
      }
    },
    `migration ${migration.version} down failed`,
  );
}

function findUpTargetIndex(
  migrations: readonly LoadedMigration[],
  targetVersion: string | undefined,
): number {
  if (targetVersion === undefined) {
    return migrations.length - 1;
  }
  const targetIndex = migrations.findIndex(
    (migration) => migration.version === targetVersion,
  );
  if (targetIndex === -1) {
    throw new MigrationExecutionError(
      "requested migration target is not in the manifest",
    );
  }
  return targetIndex;
}

async function executeLockedCommand(
  session: MigrationDatabaseSession,
  migrations: readonly LoadedMigration[],
  command: MigrationCommand,
): Promise<MigrationCommandResult> {
  try {
    await session.query(createHistoryTableSql);
  } catch {
    throw new MigrationExecutionError("could not initialize migration history");
  }

  const applied = await readAppliedMigrations(session);
  validateAppliedPrefix(migrations, applied);

  if (command.direction === "up") {
    const targetIndex = findUpTargetIndex(migrations, command.targetVersion);
    if (targetIndex + 1 < applied.length) {
      throw new MigrationExecutionError(
        "up migration target is behind the database history",
      );
    }
    const pending = migrations.slice(applied.length, targetIndex + 1);
    for (const migration of pending) {
      await applyMigration(session, migration);
    }
    const currentVersion =
      migrations[Math.max(applied.length + pending.length - 1, -1)]?.version ??
      null;
    return {
      schemaVersion: 1,
      direction: "up",
      appliedVersions: pending.map(({ version }) => version),
      revertedVersions: [],
      currentVersion,
    };
  }

  const head = applied.at(-1);
  if (head === undefined) {
    throw new MigrationExecutionError("database has no migration to revert");
  }
  if (command.confirmVersion !== head.version) {
    throw new MigrationExecutionError(
      "down migration confirmation must match the applied head",
    );
  }
  const migration = migrations[applied.length - 1];
  if (migration === undefined || migration.version !== head.version) {
    throw new MigrationExecutionError(
      "database migration history is not a manifest prefix",
    );
  }
  await revertMigration(session, migration);
  return {
    schemaVersion: 1,
    direction: "down",
    appliedVersions: [],
    revertedVersions: [migration.version],
    currentVersion: migrations[applied.length - 2]?.version ?? null,
  };
}

export async function runMigrationCommandOnSession(
  session: MigrationDatabaseSession,
  migrations: readonly LoadedMigration[],
  command: MigrationCommand,
): Promise<MigrationCommandResult> {
  const parsedCommand = parseMigrationCommand(command);
  if (parsedCommand === undefined) {
    throw new MigrationExecutionError("migration command is invalid");
  }
  try {
    await session.query("SET search_path = pg_catalog, public");
  } catch {
    throw new MigrationExecutionError(
      "could not establish a safe migration session",
    );
  }
  await acquireMigrationLock(session);

  let result: MigrationCommandResult | undefined;
  let failure: MigrationExecutionError | undefined;
  try {
    result = await executeLockedCommand(session, migrations, parsedCommand);
  } catch (error: unknown) {
    failure =
      error instanceof MigrationExecutionError
        ? error
        : new MigrationExecutionError("migration command failed");
  }

  try {
    const unlockResult = await session.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
      [migrationLockNamespace],
    );
    const firstRow = unlockResult.rows[0];
    if (
      !isRecord(firstRow) ||
      firstRow["unlocked"] !== true ||
      unlockResult.rows.length !== 1
    ) {
      throw new MigrationExecutionError("could not release the migration lock");
    }
  } catch {
    if (failure === undefined) {
      failure = new MigrationExecutionError(
        "could not release the migration lock",
      );
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (result === undefined) {
    throw new MigrationExecutionError("migration command produced no result");
  }
  return result;
}

export async function runMigrations(
  options: Readonly<{
    clientConfig: PostgresConnectionConfig;
    workspaceRoot: string;
    command: MigrationCommand;
  }>,
): Promise<MigrationCommandResult> {
  const runtimeOptions = copyOwnDataRecord(options);
  if (
    runtimeOptions === undefined ||
    !hasExactKeys(runtimeOptions, ["clientConfig", "workspaceRoot", "command"])
  ) {
    throw new MigrationExecutionError("migration configuration is invalid");
  }
  const clientConfig = normalizePostgresConnectionConfig(
    runtimeOptions["clientConfig"],
  );
  const workspaceRoot = runtimeOptions["workspaceRoot"];
  if (
    clientConfig === undefined ||
    typeof workspaceRoot !== "string" ||
    workspaceRoot.trim() === ""
  ) {
    throw new MigrationExecutionError("migration configuration is invalid");
  }
  const command = parseMigrationCommand(runtimeOptions["command"]);
  if (command === undefined) {
    throw new MigrationExecutionError("migration command is invalid");
  }
  const migrations = await loadMigrationManifest({
    workspaceRoot,
  });
  let client: Client;
  try {
    client = new Client(clientConfig);
  } catch {
    throw new MigrationExecutionError("migration configuration is invalid");
  }
  try {
    await client.connect();
  } catch {
    try {
      await client.end();
    } catch {
      // A failed connection still receives a best-effort local teardown.
    }
    throw new MigrationExecutionError("database connection failed");
  }

  try {
    const session: MigrationDatabaseSession = {
      query: async (text, values = []) => {
        const queryResult = await client.query(text, [...values]);
        return {
          rows: queryResult.rows as readonly unknown[],
          command: queryResult.command,
        };
      },
    };
    return await runMigrationCommandOnSession(session, migrations, command);
  } finally {
    try {
      await client.end();
    } catch {
      // The command result is authoritative; connection teardown has no SQL to retry.
    }
  }
}
