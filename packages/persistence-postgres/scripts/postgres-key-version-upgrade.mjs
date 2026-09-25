#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { keyVersionSchema } from "@fan-support/contracts";
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

const fixture = Object.freeze({
  paymentAttempt: "71000000-0000-4000-8000-000000000001",
  webhookPayload: "71000000-0000-4000-8000-000000000002",
});
const paymentKeyVersion = "envelope-2026-09";
const webhookKeyVersion = "webhook.key-2026:09";

class KeyVersionUpgradeHarnessError extends Error {}

function fail(message) {
  throw new KeyVersionUpgradeHarnessError(message);
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

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The isolated connection is closed by the harness as a final fallback.
  }
}

async function runReplicaTransaction(client, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await operation();
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function seedVersionSixNumericKeys(client) {
  await runReplicaTransaction(client, async () => {
    await client.query(
      `INSERT INTO public.payment_attempts (
         id, order_id, provider_account_id, environment, config_version_id,
         config_version, route_rule_id, rule_version, payment_method, status,
         amount_minor, currency, requested_locale, provider_locale,
         provider_locale_fallback_used, merchant_reference,
         provider_idempotency_key, provider_call_started, action_type,
         action_ciphertext, action_encrypted_data_key, action_key_version,
         return_state_digest, return_state_expires_at, status_evidence_kind
       ) VALUES (
         $1, '71000000-0000-4000-8000-000000000011',
         '71000000-0000-4000-8000-000000000012', 'TEST',
         '71000000-0000-4000-8000-000000000013', 1,
         '71000000-0000-4000-8000-000000000014', 1, 'card',
         'REQUIRES_ACTION', 100, 'USD', 'en', 'en', false, $1::uuid::text,
         $1::uuid::text, true, 'REDIRECT', decode(repeat('71', 16), 'hex'),
         decode(repeat('72', 16), 'hex'), 7,
         decode(repeat('73', 32), 'hex'),
         transaction_timestamp() + interval '1 hour', 'CREATE_RESULT'
       )`,
      [fixture.paymentAttempt],
    );
    await client.query(
      `INSERT INTO public.webhook_payloads (
         id, payload_ciphertext, encrypted_data_key, encryption_key_version,
         payload_sha256, status, retention_expires_at
       ) VALUES (
         $1, decode(repeat('74', 16), 'hex'),
         decode(repeat('75', 16), 'hex'), 9, repeat('7', 64), 'RETAINED',
         transaction_timestamp() + interval '1 day'
       )`,
      [fixture.webhookPayload],
    );
  });
}

async function updateKeyVersion(client, query, values) {
  try {
    await runReplicaTransaction(client, async () => {
      await client.query(query, values);
    });
    return undefined;
  } catch (error) {
    return error;
  }
}

async function writeContractKeyVersions(client) {
  for (const value of [paymentKeyVersion, webhookKeyVersion]) {
    if (!keyVersionSchema.safeParse(value).success) {
      fail("key-version fixture does not satisfy the canonical contract");
    }
  }

  const paymentFailure = await updateKeyVersion(
    client,
    "UPDATE public.payment_attempts SET action_key_version = $2 WHERE id = $1",
    [fixture.paymentAttempt, paymentKeyVersion],
  );
  const webhookFailure = await updateKeyVersion(
    client,
    "UPDATE public.webhook_payloads SET encryption_key_version = $2 WHERE id = $1",
    [fixture.webhookPayload, webhookKeyVersion],
  );
  const failures = [
    ["PAYMENT_ACTION", paymentFailure],
    ["WEBHOOK_PAYLOAD", webhookFailure],
  ].filter((entry) => entry[1] !== undefined);

  if (failures.length > 0) {
    fail(
      `canonical key versions were rejected: ${failures
        .map(([label, error]) => `${label}(${databaseErrorCode(error)})`)
        .join(", ")}`,
    );
  }
}

async function readKeyState(client) {
  const result = await client.query(
    `SELECT
       pg_catalog.format_type(payment_attribute.atttypid, payment_attribute.atttypmod)
         AS "paymentType",
       pg_catalog.format_type(webhook_attribute.atttypid, webhook_attribute.atttypmod)
         AS "webhookType",
       (SELECT action_key_version::text FROM public.payment_attempts WHERE id = $1)
         AS "paymentValue",
       (SELECT encryption_key_version::text FROM public.webhook_payloads WHERE id = $2)
         AS "webhookValue"
     FROM pg_catalog.pg_attribute payment_attribute
     JOIN pg_catalog.pg_class payment_table
       ON payment_table.oid = payment_attribute.attrelid
     JOIN pg_catalog.pg_namespace payment_namespace
       ON payment_namespace.oid = payment_table.relnamespace
     CROSS JOIN pg_catalog.pg_attribute webhook_attribute
     JOIN pg_catalog.pg_class webhook_table
       ON webhook_table.oid = webhook_attribute.attrelid
     JOIN pg_catalog.pg_namespace webhook_namespace
       ON webhook_namespace.oid = webhook_table.relnamespace
     WHERE payment_namespace.nspname = 'public'
       AND payment_table.relname = 'payment_attempts'
       AND payment_attribute.attname = 'action_key_version'
       AND NOT payment_attribute.attisdropped
       AND webhook_namespace.nspname = 'public'
       AND webhook_table.relname = 'webhook_payloads'
       AND webhook_attribute.attname = 'encryption_key_version'
       AND NOT webhook_attribute.attisdropped`,
    [fixture.paymentAttempt, fixture.webhookPayload],
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) {
    fail("key-version catalog state was unavailable");
  }
  return row;
}

async function expectConstraintFailure(client, query, values, label) {
  const error = await updateKeyVersion(client, query, values);
  if (databaseErrorCode(error) !== "23514") {
    fail(`${label} did not fail with a check-constraint violation`);
  }
}

async function assertTextConstraints(client) {
  const constraints = await client.query(
    `SELECT constraint_row.conname AS name,
            pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
       FROM pg_catalog.pg_constraint constraint_row
      WHERE constraint_row.conname IN (
        'payment_attempts_action_key_version_check',
        'webhook_payloads_encryption_key_version_check'
      )
      ORDER BY constraint_row.conname`,
  );
  assertEqual(constraints.rows.length, 2, "key-version constraint count");
  for (const row of constraints.rows) {
    if (
      typeof row.definition !== "string" ||
      !row.definition.includes("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    ) {
      fail("key-version constraint diverged from the canonical contract");
    }
  }

  await expectConstraintFailure(
    client,
    "UPDATE public.payment_attempts SET action_key_version = $2 WHERE id = $1",
    [fixture.paymentAttempt, "../unsafe"],
    "payment action key version",
  );
  await expectConstraintFailure(
    client,
    "UPDATE public.webhook_payloads SET encryption_key_version = $2 WHERE id = $1",
    [fixture.webhookPayload, `a${"b".repeat(128)}`],
    "webhook payload key version",
  );
}

async function assertUnsafeDowngradeFails(clientConfig, client) {
  let failure;
  try {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0007" },
    });
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof MigrationExecutionError)) {
    fail("migration 0007 downgrade unexpectedly accepted textual key versions");
  }

  const history = await client.query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  );
  assertEqual(history.rows[0]?.version, "0007", "failed downgrade head");
  const state = await readKeyState(client);
  assertEqual(state.paymentType, "text", "failed downgrade payment type");
  assertEqual(state.webhookType, "text", "failed downgrade webhook type");
  assertEqual(
    state.paymentValue,
    paymentKeyVersion,
    "failed downgrade payment value",
  );
  assertEqual(
    state.webhookValue,
    webhookKeyVersion,
    "failed downgrade webhook value",
  );
}

async function restoreNumericText(client) {
  await runReplicaTransaction(client, async () => {
    await client.query(
      "UPDATE public.payment_attempts SET action_key_version = '7' WHERE id = $1",
      [fixture.paymentAttempt],
    );
    await client.query(
      "UPDATE public.webhook_payloads SET encryption_key_version = '9' WHERE id = $1",
      [fixture.webhookPayload],
    );
  });
}

async function runUpgradeHarness(clientConfig) {
  const baseResult = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0006" },
  });
  assertEqual(baseResult.currentVersion, "0006", "pre-upgrade migration head");

  const client = new Client(clientConfig);
  try {
    await client.connect();
    await seedVersionSixNumericKeys(client);

    const upgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0007" },
    });

    const converted = await readKeyState(client);
    assertEqual(converted.paymentValue, "7", "converted payment key version");
    assertEqual(converted.webhookValue, "9", "converted webhook key version");

    await writeContractKeyVersions(client);
    assertEqual(upgrade.currentVersion, "0007", "upgraded migration head");
    const textState = await readKeyState(client);
    assertEqual(textState.paymentType, "text", "payment key-version type");
    assertEqual(textState.webhookType, "text", "webhook key-version type");
    await assertTextConstraints(client);
    await assertUnsafeDowngradeFails(clientConfig, client);

    await restoreNumericText(client);
    const downgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0007" },
    });
    assertEqual(downgrade.currentVersion, "0006", "downgraded migration head");
    const numericState = await readKeyState(client);
    assertEqual(
      numericState.paymentType,
      "positive_version",
      "downgraded payment type",
    );
    assertEqual(
      numericState.webhookType,
      "positive_version",
      "downgraded webhook type",
    );
    assertEqual(numericState.paymentValue, "7", "downgraded payment value");
    assertEqual(numericState.webhookValue, "9", "downgraded webhook value");

    const reapplied = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0007" },
    });
    assertEqual(reapplied.currentVersion, "0007", "reapplied migration head");
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
        error instanceof KeyVersionUpgradeHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError
      ) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        "PostgreSQL key-version migration integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL key-version migration passed (${result.migrations} forward migration reapplied).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL key-version migration integration failed";
  console.error(message);
  process.exitCode = 1;
}
