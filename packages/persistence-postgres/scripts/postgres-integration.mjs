#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  assertCatalogMatches,
  captureDatabaseCatalog,
  DatabaseCatalogError,
  EphemeralPostgresError,
  MigrationExecutionError,
  MigrationManifestError,
  parseDatabaseCatalogSnapshot,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const catalogPath = path.join(
  workspaceRoot,
  "database/schema/expected-catalog.json",
);
const writeCatalog = process.argv.includes("--write-catalog");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--write-catalog");

if (unknownArguments.length > 0) {
  throw new EphemeralPostgresError("unsupported PostgreSQL harness argument");
}

async function captureCatalog(clientConfig) {
  const client = new Client(clientConfig);
  try {
    await client.connect();
    return await captureDatabaseCatalog({
      query: async (text, values = []) => {
        const result = await client.query(text, [...values]);
        return { rows: result.rows };
      },
    });
  } catch (error) {
    if (error instanceof DatabaseCatalogError) {
      throw error;
    }
    throw new DatabaseCatalogError("database catalog connection failed");
  } finally {
    try {
      await client.end();
    } catch {
      // The next harness step creates a fresh connection.
    }
  }
}

async function readExpectedCatalog() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    throw new DatabaseCatalogError(
      "committed database catalog is not valid JSON",
    );
  }
  return parseDatabaseCatalogSnapshot(parsed);
}

async function runRoundTrip(clientConfig) {
  const initialUp = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const headVersion = initialUp.currentVersion;
  if (initialUp.appliedVersions.length === 0 || headVersion === null) {
    throw new MigrationManifestError("migration manifest is empty");
  }
  if (initialUp.appliedVersions.at(-1) !== headVersion) {
    throw new MigrationExecutionError(
      "empty database did not apply every migration",
    );
  }
  const catalogBeforeRollback = await captureCatalog(clientConfig);

  const rollback = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: headVersion },
  });
  if (
    rollback.revertedVersions.length !== 1 ||
    rollback.revertedVersions[0] !== headVersion
  ) {
    throw new MigrationExecutionError(
      "migration head rollback was not confirmed",
    );
  }

  const forwardFix = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: headVersion },
  });
  if (
    forwardFix.appliedVersions.length !== 1 ||
    forwardFix.appliedVersions[0] !== headVersion
  ) {
    throw new MigrationExecutionError(
      "rolled-back migration was not reapplied",
    );
  }
  const catalogAfterForwardFix = await captureCatalog(clientConfig);
  assertCatalogMatches(catalogAfterForwardFix, catalogBeforeRollback);

  if (writeCatalog) {
    await mkdir(path.dirname(catalogPath), { recursive: true });
    await writeFile(
      catalogPath,
      `${JSON.stringify(catalogAfterForwardFix, null, 2)}\n`,
    );
  } else {
    assertCatalogMatches(catalogAfterForwardFix, await readExpectedCatalog());
  }

  return {
    migrations: initialUp.appliedVersions.length,
    tables: catalogAfterForwardFix.tables.length,
  };
}

try {
  const result = await withEphemeralPostgres(async (clientConfig) => {
    try {
      return await runRoundTrip(clientConfig);
    } catch (error) {
      if (
        error instanceof MigrationManifestError ||
        error instanceof MigrationExecutionError ||
        error instanceof DatabaseCatalogError
      ) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        "PostgreSQL migration integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL migration round-trip passed (${result.migrations} migrations, ${result.tables} tables).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL migration integration failed";
  console.error(message);
  process.exitCode = 1;
}
