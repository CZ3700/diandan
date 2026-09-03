#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { mediaObjectKeySchema } from "@fan-support/contracts";
import { Client } from "pg";

import {
  EphemeralPostgresError,
  MigrationExecutionError,
  MigrationManifestError,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const legacyObjectKey = "derivatives/./asset.webp";
const fixture = Object.freeze({
  mediaAsset: "72000000-0000-4000-8000-000000000001",
});

class MediaObjectKeyUpgradeHarnessError extends Error {}

function fail(message) {
  throw new MediaObjectKeyUpgradeHarnessError(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} did not match`);
  }
}

function databaseErrorCode(error) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "unknown";
}

async function expectObjectKeyAccepted(client, value, label) {
  try {
    await client.query("SELECT $1::media_object_key", [value]);
  } catch {
    fail(`${label} was unexpectedly rejected`);
  }
}

async function expectObjectKeyRejected(client, value, label) {
  let failure;
  try {
    await client.query("SELECT $1::media_object_key", [value]);
  } catch (error) {
    failure = error;
  }
  if (databaseErrorCode(failure) !== "23514") {
    fail(`${label} did not fail with a check-constraint violation`);
  }
}

async function readMigrationHead(client) {
  const result = await client.query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  );
  return result.rows[0]?.version;
}

async function readDomainConstraint(client) {
  const result = await client.query(
    `SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
       FROM pg_catalog.pg_constraint constraint_row
       JOIN pg_catalog.pg_type domain_type
         ON domain_type.oid = constraint_row.contypid
       JOIN pg_catalog.pg_namespace domain_namespace
         ON domain_namespace.oid = domain_type.typnamespace
      WHERE domain_namespace.nspname = 'public'
        AND domain_type.typname = 'media_object_key'
        AND constraint_row.conname = 'media_object_key_check'`,
  );
  const definition = result.rows[0]?.definition;
  if (result.rows.length !== 1 || typeof definition !== "string") {
    fail("media object-key domain constraint was unavailable");
  }
  return definition;
}

function assertLegacyConstraint(definition, label) {
  if (
    !definition.includes("(^|/)\\.\\.(/|$)") ||
    definition.includes("\\.{1,2}")
  ) {
    fail(`${label} did not restore the legacy domain semantics`);
  }
}

function assertHardenedConstraint(definition, label) {
  if (
    !definition.includes("(^|/)\\.{1,2}(/|$)") ||
    !definition.includes("//|/$")
  ) {
    fail(`${label} did not enforce canonical path segments`);
  }
}

async function seedLegacyObjectKey(client) {
  await client.query(
    `INSERT INTO public.media_assets (
       id, checksum_sha256, mime_type, width, height, byte_size, object_key,
       processing_status, rights_status, rights_reference
     ) VALUES (
       $1, repeat('7', 64), 'image/webp', 1200, 1500, 1024, $2,
       'READY', 'APPROVED', 'legacy-upgrade-fixture'
     )`,
    [fixture.mediaAsset, legacyObjectKey],
  );
}

async function assertFailedUpgradeWasAtomic(clientConfig, client) {
  let failure;
  try {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0008" },
    });
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof MigrationExecutionError)) {
    fail("migration 0008 unexpectedly accepted a legacy dot path segment");
  }

  assertEqual(await readMigrationHead(client), "0007", "failed-upgrade head");
  const row = await client.query(
    "SELECT object_key::text AS value FROM public.media_assets WHERE id = $1",
    [fixture.mediaAsset],
  );
  assertEqual(
    row.rows[0]?.value,
    legacyObjectKey,
    "failed-upgrade legacy value",
  );
  assertLegacyConstraint(
    await readDomainConstraint(client),
    "failed-upgrade constraint",
  );
  await expectObjectKeyAccepted(
    client,
    legacyObjectKey,
    "legacy dot path after failed upgrade",
  );
  await expectObjectKeyRejected(
    client,
    "derivatives/../asset.webp",
    "legacy parent path after failed upgrade",
  );
}

async function assertHardenedRules(client, label) {
  assertHardenedConstraint(await readDomainConstraint(client), label);
  await expectObjectKeyRejected(
    client,
    legacyObjectKey,
    `${label} dot path segment`,
  );
  await expectObjectKeyRejected(
    client,
    "derivatives/../asset.webp",
    `${label} parent path segment`,
  );
  await expectObjectKeyRejected(
    client,
    "derivatives//asset.webp",
    `${label} empty path segment`,
  );
  await expectObjectKeyRejected(
    client,
    "derivatives/asset.webp/",
    `${label} trailing path separator`,
  );
  for (const [index, value] of [
    "derivatives/.../asset.webp",
    "derivatives/.hidden/asset.webp",
    "derivatives/asset./asset.webp",
  ].entries()) {
    await expectObjectKeyAccepted(
      client,
      value,
      `${label} canonical edge case ${index + 1}`,
    );
  }
}

async function runUpgradeHarness(clientConfig) {
  const baseResult = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0007" },
  });
  assertEqual(baseResult.currentVersion, "0007", "pre-upgrade migration head");

  if (mediaObjectKeySchema.safeParse(legacyObjectKey).success) {
    fail("legacy object-key fixture was unexpectedly accepted by the contract");
  }

  const client = new Client(clientConfig);
  try {
    await client.connect();
    await expectObjectKeyAccepted(
      client,
      legacyObjectKey,
      "legacy database dot path segment",
    );
    await seedLegacyObjectKey(client);
    await assertFailedUpgradeWasAtomic(clientConfig, client);

    await client.query("DELETE FROM public.media_assets WHERE id = $1", [
      fixture.mediaAsset,
    ]);
    const upgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0008" },
    });
    assertEqual(upgrade.currentVersion, "0008", "upgraded migration head");
    await assertHardenedRules(client, "upgraded constraint");

    const downgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0008" },
    });
    assertEqual(downgrade.currentVersion, "0007", "downgraded migration head");
    assertLegacyConstraint(
      await readDomainConstraint(client),
      "downgraded constraint",
    );
    await expectObjectKeyAccepted(
      client,
      legacyObjectKey,
      "downgraded dot path segment",
    );
    await expectObjectKeyRejected(
      client,
      "derivatives/../asset.webp",
      "downgraded parent path segment",
    );

    const reapplied = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0008" },
    });
    assertEqual(reapplied.currentVersion, "0008", "reapplied migration head");
    await assertHardenedRules(client, "reapplied constraint");
    return { migrations: reapplied.appliedVersions.length };
  } finally {
    try {
      await client.end();
    } catch {
      // The ephemeral PostgreSQL harness owns process-level cleanup.
    }
  }
}

try {
  const result = await withEphemeralPostgres(async (clientConfig) => {
    try {
      return await runUpgradeHarness(clientConfig);
    } catch (error) {
      if (
        error instanceof MediaObjectKeyUpgradeHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError
      ) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        "PostgreSQL media object-key migration integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL media object-key migration passed (${result.migrations} forward migration reapplied).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL media object-key migration integration failed";
  console.error(message);
  process.exitCode = 1;
}
