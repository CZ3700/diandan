#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  createPostgresPersistence,
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
const initialOccurredAt = "2026-02-01T00:00:00.000Z";
const advancedOccurredAt = "2026-02-02T00:00:00.000Z";
const legacyOccurredAt = "2026-02-03T00:00:00.000Z";
const transactionOptions = Object.freeze({
  schemaVersion: 1,
  isolationLevel: "READ_COMMITTED",
});
let currentPhase = "initialization";
const fixture = Object.freeze({
  orderId: "73000000-0000-4000-8000-000000000001",
  publicOrderId: "73000000-0000-4000-8000-000000000002",
  checkoutSessionId: "73000000-0000-4000-8000-000000000003",
  checkoutQuoteId: "73000000-0000-4000-8000-000000000004",
  cartId: "73000000-0000-4000-8000-000000000005",
  customerContactId: "73000000-0000-4000-8000-000000000006",
  orderItemId: "73000000-0000-4000-8000-000000000007",
  idolId: "73000000-0000-4000-8000-000000000008",
  fulfillmentProfileId: "73000000-0000-4000-8000-000000000009",
  fulfillmentId: "73000000-0000-4000-8000-000000000010",
  preparationEventId: "73000000-0000-4000-8000-000000000011",
  deliveryEventId: "73000000-0000-4000-8000-000000000012",
  preparationRequestId: "73000000-0000-4000-8000-000000000013",
  preparationCorrelationId: "73000000-0000-4000-8000-000000000014",
  deliveryRequestId: "73000000-0000-4000-8000-000000000015",
  deliveryCorrelationId: "73000000-0000-4000-8000-000000000016",
  historicalOutboxId: "73000000-0000-4000-8000-000000000017",
  driftedOutboxId: "73000000-0000-4000-8000-000000000018",
  orphanOutboxId: "73000000-0000-4000-8000-000000000019",
  orphanAggregateId: "73000000-0000-4000-8000-000000000020",
  paymentAttemptId: "73000000-0000-4000-8000-000000000021",
  appFirstOutboxId: "73000000-0000-4000-8000-000000000022",
  legacyEventId: "73000000-0000-4000-8000-000000000023",
  legacyOutboxId: "73000000-0000-4000-8000-000000000024",
  legacyRequestId: "73000000-0000-4000-8000-000000000025",
  legacyCorrelationId: "73000000-0000-4000-8000-000000000026",
});

class OutboxStatusUpgradeHarnessError extends Error {}

function fail(message) {
  throw new OutboxStatusUpgradeHarnessError(message);
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
    // The ephemeral PostgreSQL instance is the final cleanup boundary.
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

async function readMigrationHead(client) {
  const result = await client.query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  );
  return result.rows[0]?.version;
}

async function payloadStatusColumnExists(client) {
  const result = await client.query(
    `SELECT count(*)::integer AS count
       FROM pg_catalog.pg_attribute attribute
       JOIN pg_catalog.pg_class table_row ON table_row.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace namespace_row
         ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname = 'outbox_events'
        AND attribute.attname = 'payload_status'
        AND NOT attribute.attisdropped`,
  );
  return result.rows[0]?.count === 1;
}

async function seedVersionEightStatusHistory(client) {
  await runReplicaTransaction(client, async () => {
    currentPhase = "seed order";
    await client.query(
      `INSERT INTO orders (
         id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
         customer_contact_id, presentation_locale, market, currency,
         quote_revision, quote_expires_at, subtotal_minor, tax_amount_minor,
         shipping_amount_minor, fee_amount_minor, discount_amount_minor,
         total_amount_minor, order_status, payment_status, dispute_status,
         fulfillment_status, current_payment_attempt_id, version, created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'en', 'US', 'USD', 1,
         '2099-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0,
         'OPEN', 'PAID', 'NONE', 'DELIVERED', $7, 1, $8, $9
       )`,
      [
        fixture.orderId,
        fixture.publicOrderId,
        fixture.checkoutSessionId,
        fixture.checkoutQuoteId,
        fixture.cartId,
        fixture.customerContactId,
        fixture.paymentAttemptId,
        initialOccurredAt,
        advancedOccurredAt,
      ],
    );
    currentPhase = "seed fulfillment";
    await client.query(
      `INSERT INTO fulfillments (
         id, order_id, order_item_id, idol_id, fulfillment_profile_id,
         status, version, prepared_at, delivered_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'DELIVERED', 3, $6, $7, $6, $7)`,
      [
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.orderItemId,
        fixture.idolId,
        fixture.fulfillmentProfileId,
        initialOccurredAt,
        advancedOccurredAt,
      ],
    );
    currentPhase = "seed fulfillment events";
    await client.query(
      `INSERT INTO fulfillment_events (
         id, fulfillment_id, order_id, sequence, from_status, to_status,
         authority_kind, reason_code, request_id, correlation_id, occurred_at
       ) VALUES
         ($1, $2, $3, 2, 'PENDING', 'PREPARING', 'WORKER',
          'PREPARATION_STARTED', $4, $5, $6),
         ($7, $2, $3, 3, 'PREPARING', 'DELIVERED', 'WORKER',
          'DELIVERY_CONFIRMED', $8, $9, $10)`,
      [
        fixture.preparationEventId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.preparationRequestId,
        fixture.preparationCorrelationId,
        initialOccurredAt,
        fixture.deliveryEventId,
        fixture.deliveryRequestId,
        fixture.deliveryCorrelationId,
        advancedOccurredAt,
      ],
    );
    currentPhase = "seed legacy outbox";
    await client.query(
      `INSERT INTO outbox_events (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         primary_subject_id, secondary_subject_id, locale, market, currency,
         idempotency_key, correlation_id, request_id, occurred_at, available_at
       ) VALUES
         ($1, 'FULFILLMENT_STATUS_CHANGED', 'FULFILLMENT', $2, 2,
          $2, $3, 'en', 'US', 'USD', 'outbox-status-upgrade-history-0001',
          $4, $5, $6::timestamptz, $6::timestamptz),
         ($7, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $8, 1,
          $8, $3, 'en', 'US', 'USD', 'outbox-status-upgrade-orphan-0001',
          $4, $5, $6::timestamptz, $6::timestamptz)`,
      [
        fixture.historicalOutboxId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.preparationCorrelationId,
        fixture.preparationRequestId,
        initialOccurredAt,
        fixture.orphanOutboxId,
        fixture.orphanAggregateId,
      ],
    );
  });
}

function currentAdapterStatusCommand() {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: fixture.appFirstOutboxId,
      eventType: "FULFILLMENT_STATUS_CHANGED",
      aggregateId: fixture.fulfillmentId,
      occurredAt: advancedOccurredAt,
      correlationId: fixture.deliveryCorrelationId,
      requestId: fixture.deliveryRequestId,
      payload: {
        fulfillmentId: fixture.fulfillmentId,
        orderId: fixture.orderId,
        status: "DELIVERED",
      },
    },
    aggregateVersion: 3,
    primarySubjectId: fixture.fulfillmentId,
    secondarySubjectId: fixture.orderId,
    market: "US",
    currency: "USD",
    idempotencyKey: "outbox-status-upgrade-app-first-0001",
    availableAt: advancedOccurredAt,
  };
}

async function assertCurrentAdapterWritesAtVersionEight(clientConfig, client) {
  assertEqual(
    await payloadStatusColumnExists(client),
    false,
    "app-first version-eight column",
  );
  const persistence = createPostgresPersistence({
    ...clientConfig,
    application_name: "p1-05-outbox-status-app-first",
  });
  try {
    const response = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ outbox }) => outbox.append(currentAdapterStatusCommand()),
    );
    if (response.outcome !== "SUCCESS") {
      fail(`app-first adapter response failed (${response.error.code})`);
    }
    const driftedReplay = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ outbox }) =>
        outbox.append({
          ...currentAdapterStatusCommand(),
          event: {
            ...currentAdapterStatusCommand().event,
            payload: {
              ...currentAdapterStatusCommand().event.payload,
              status: "PREPARING",
            },
          },
        }),
    );
    assertEqual(
      driftedReplay.outcome,
      "FAILURE",
      "app-first payload-drift replay outcome",
    );
    assertEqual(
      driftedReplay.error?.code,
      "IDEMPOTENCY_CONFLICT",
      "app-first payload-drift replay code",
    );
  } finally {
    await persistence.close();
  }
  const row = await client.query(
    "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
    [fixture.appFirstOutboxId],
  );
  assertEqual(row.rows[0]?.count, 1, "app-first version-eight row");
}

async function assertFailedUpgradeWasAtomic(clientConfig, client) {
  let failure;
  try {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0009" },
    });
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof MigrationExecutionError)) {
    fail("migration 0009 unexpectedly accepted orphaned status history");
  }
  assertEqual(await readMigrationHead(client), "0008", "failed-upgrade head");
  assertEqual(
    await payloadStatusColumnExists(client),
    false,
    "failed-upgrade column state",
  );
  const rows = await client.query(
    "SELECT count(*)::integer AS count FROM outbox_events WHERE id IN ($1, $2)",
    [fixture.historicalOutboxId, fixture.orphanOutboxId],
  );
  assertEqual(rows.rows[0]?.count, 2, "failed-upgrade immutable rows");
}

async function deleteOrphanFixture(client) {
  await runReplicaTransaction(client, async () => {
    await client.query("DELETE FROM outbox_events WHERE id = $1", [
      fixture.orphanOutboxId,
    ]);
  });
}

async function assertTypedStatusState(client, label, expectedHeadStatus) {
  assertEqual(await payloadStatusColumnExists(client), true, `${label} column`);
  const row = await client.query(
    `SELECT outbox.payload_status, fulfillment.status AS current_status,
            outbox.aggregate_version::text AS aggregate_version
       FROM outbox_events outbox
       JOIN fulfillments fulfillment ON fulfillment.id = outbox.aggregate_id
      WHERE outbox.id = $1`,
    [fixture.historicalOutboxId],
  );
  assertEqual(row.rows[0]?.payload_status, "PREPARING", `${label} payload`);
  assertEqual(
    row.rows[0]?.current_status,
    expectedHeadStatus,
    `${label} head status`,
  );
  assertEqual(row.rows[0]?.aggregate_version, "2", `${label} event version`);
  const appFirst = await client.query(
    "SELECT payload_status FROM outbox_events WHERE id = $1",
    [fixture.appFirstOutboxId],
  );
  assertEqual(
    appFirst.rows[0]?.payload_status,
    "DELIVERED",
    `${label} app-first payload`,
  );

  const triggers = await client.query(
    `SELECT trigger_row.tgname AS name, trigger_row.tgenabled AS enabled
       FROM pg_catalog.pg_trigger trigger_row
       JOIN pg_catalog.pg_class table_row ON table_row.oid = trigger_row.tgrelid
       JOIN pg_catalog.pg_namespace namespace_row
         ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname = 'outbox_events'
         AND trigger_row.tgname IN (
           'outbox_events_append_only_trigger',
           'outbox_payload_status_derivation_trigger',
           'outbox_payload_status_authority_trigger'
        )
      ORDER BY trigger_row.tgname`,
  );
  assertEqual(triggers.rows.length, 3, `${label} trigger count`);
  if (triggers.rows.some((trigger) => trigger.enabled !== "O")) {
    fail(`${label} left an outbox trigger disabled`);
  }
}

async function seedLegacyStatusSource(client) {
  await runReplicaTransaction(client, async () => {
    await client.query(
      `UPDATE fulfillments
          SET status = 'ON_HOLD', version = 4,
              hold_reason_code = 'DELIVERY_REVIEW_REQUIRED',
              delivered_at = NULL, updated_at = $2
        WHERE id = $1`,
      [fixture.fulfillmentId, legacyOccurredAt],
    );
    await client.query(
      `UPDATE orders
          SET fulfillment_status = 'ON_HOLD', updated_at = $2
        WHERE id = $1`,
      [fixture.orderId, legacyOccurredAt],
    );
    await client.query(
      `INSERT INTO fulfillment_events (
         id, fulfillment_id, order_id, sequence, from_status, to_status,
         authority_kind, reason_code, request_id, correlation_id, occurred_at
       ) VALUES (
         $1, $2, $3, 4, 'DELIVERED', 'ON_HOLD', 'WORKER',
         'DELIVERY_REVIEW_REQUIRED', $4, $5, $6
       )`,
      [
        fixture.legacyEventId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.legacyRequestId,
        fixture.legacyCorrelationId,
        legacyOccurredAt,
      ],
    );
  });
}

async function assertLegacyWriterAtVersionNine(client) {
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES (
       $1, 'FULFILLMENT_STATUS_CHANGED', 'FULFILLMENT', $2, 4,
       $2, $3, 'en', 'US', 'USD', 'outbox-status-upgrade-legacy-writer-0001',
       $4, $5, $6::timestamptz, $6::timestamptz
     )`,
    [
      fixture.legacyOutboxId,
      fixture.fulfillmentId,
      fixture.orderId,
      fixture.legacyCorrelationId,
      fixture.legacyRequestId,
      legacyOccurredAt,
    ],
  );
  const row = await client.query(
    "SELECT payload_status FROM outbox_events WHERE id = $1",
    [fixture.legacyOutboxId],
  );
  assertEqual(row.rows[0]?.payload_status, "ON_HOLD", "legacy writer payload");
}

async function assertDirectStatusDriftRejected(client) {
  let failure;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO outbox_events (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         primary_subject_id, secondary_subject_id, locale, market, currency,
         idempotency_key, correlation_id, request_id, occurred_at, available_at,
         payload_status
       ) VALUES (
         $1, 'FULFILLMENT_STATUS_CHANGED', 'FULFILLMENT', $2, 4,
         $2, $3, 'en', 'US', 'USD', 'outbox-status-upgrade-drift-0001',
         $4, $5, $6::timestamptz, $6::timestamptz, 'PREPARING'
       )`,
      [
        fixture.driftedOutboxId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.legacyCorrelationId,
        fixture.legacyRequestId,
        legacyOccurredAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    failure = error;
    await rollbackQuietly(client);
  }
  if (databaseErrorCode(failure) !== "23514") {
    fail("direct status drift did not fail with an integrity violation");
  }
  const row = await client.query(
    "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
    [fixture.driftedOutboxId],
  );
  assertEqual(row.rows[0]?.count, 0, "rejected status drift row count");
}

async function assertVersionEightState(client) {
  assertEqual(await readMigrationHead(client), "0008", "downgraded head");
  assertEqual(
    await payloadStatusColumnExists(client),
    false,
    "downgraded column state",
  );
  const trigger = await client.query(
    `SELECT trigger_row.tgenabled AS enabled
       FROM pg_catalog.pg_trigger trigger_row
       JOIN pg_catalog.pg_class table_row ON table_row.oid = trigger_row.tgrelid
       JOIN pg_catalog.pg_namespace namespace_row
         ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname = 'outbox_events'
        AND trigger_row.tgname = 'outbox_events_append_only_trigger'`,
  );
  assertEqual(trigger.rows[0]?.enabled, "O", "downgraded append-only trigger");
}

async function runUpgradeHarness(clientConfig) {
  currentPhase = "migrate to 0008";
  const base = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0008" },
  });
  assertEqual(base.currentVersion, "0008", "pre-upgrade head");

  const client = new Client(clientConfig);
  try {
    await client.connect();
    await seedVersionEightStatusHistory(client);
    currentPhase = "assert app-first version-eight writer";
    await assertCurrentAdapterWritesAtVersionEight(clientConfig, client);
    currentPhase = "assert failed upgrade";
    await assertFailedUpgradeWasAtomic(clientConfig, client);
    currentPhase = "delete orphan fixture";
    await deleteOrphanFixture(client);

    currentPhase = "upgrade to 0009";
    const upgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0009" },
    });
    assertEqual(upgrade.currentVersion, "0009", "upgraded head");
    currentPhase = "assert typed status";
    await assertTypedStatusState(client, "upgraded", "DELIVERED");
    currentPhase = "seed legacy writer source";
    await seedLegacyStatusSource(client);
    currentPhase = "assert direct status drift";
    await assertDirectStatusDriftRejected(client);
    currentPhase = "assert legacy version-nine writer";
    await assertLegacyWriterAtVersionNine(client);

    currentPhase = "downgrade to 0008";
    const downgrade = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0009" },
    });
    assertEqual(downgrade.currentVersion, "0008", "downgraded head result");
    await assertVersionEightState(client);

    currentPhase = "reapply 0009";
    const reapplied = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0009" },
    });
    assertEqual(reapplied.currentVersion, "0009", "reapplied head");
    await assertTypedStatusState(client, "reapplied", "ON_HOLD");
  } finally {
    try {
      await client.end();
    } catch {
      // The ephemeral PostgreSQL harness owns process-level cleanup.
    }
  }
}

try {
  await withEphemeralPostgres(async (clientConfig) => {
    try {
      await runUpgradeHarness(clientConfig);
    } catch (error) {
      if (
        error instanceof OutboxStatusUpgradeHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError
      ) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        `PostgreSQL outbox-status migration integration failed during ${currentPhase} (${databaseErrorCode(error)})`,
      );
    }
  });
  console.log(
    "PostgreSQL outbox-status migration passed (fail-closed backfill, typed authority, down/up).",
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL outbox-status migration integration failed";
  console.error(message);
  process.exitCode = 1;
}
