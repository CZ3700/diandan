#!/usr/bin/env node

import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";

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
const transactionOptions = Object.freeze({
  schemaVersion: 1,
  isolationLevel: "READ_COMMITTED",
});
const sourceOccurredAt = "2026-01-02T00:00:00.000Z";

class RepositoryHarnessError extends Error {}

function fail(message) {
  throw new RepositoryHarnessError(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(
      `${message}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function assertSuccess(response, operation) {
  assertEqual(response.operation, operation, "repository operation mismatch");
  assertEqual(response.outcome, "SUCCESS", `${operation} did not succeed`);
  return response.value;
}

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The ephemeral container is the final cleanup boundary.
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function trackPromise(promise) {
  const state = { settled: false };
  const outcome = promise.then(
    (value) => {
      state.settled = true;
      return { ok: true, value };
    },
    (error) => {
      state.settled = true;
      return { ok: false, error };
    },
  );
  return { state, outcome };
}

async function observeLockWait(observer, applicationName, state, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT wait_event_type
         FROM pg_stat_activity
        WHERE application_name = $1`,
      [applicationName],
    );
    if (result.rows.some((row) => row.wait_event_type === "Lock")) {
      return;
    }
    if (state.settled) {
      fail(`${label} settled before PostgreSQL exposed its lock wait`);
    }
    await yieldToEventLoop();
  }
  fail(`${label} did not reach an observable PostgreSQL lock wait`);
}

async function assertIdempotencyRepositories(clientConfig, observer) {
  const persistence = createPostgresPersistence({
    ...clientConfig,
    application_name: "p1-05-idempotency-main",
  });
  try {
    const identity = Object.freeze({
      actor: "actor-ref:v1:system:61000000-0000-4000-8000-000000000001",
      idempotencyOperation: "checkout.create",
      idempotencyKey: "repository-idempotency-0001",
      canonicalRequestHash: "a".repeat(64),
    });
    const beginCommand = {
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      ...identity,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const started = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ idempotency }) => idempotency.begin(beginCommand),
    );
    assertEqual(
      assertSuccess(started, "BEGIN_IDEMPOTENCY").decision,
      "STARTED",
      "first idempotency claim was not started",
    );

    const completeCommand = {
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      ...identity,
      status: "SUCCEEDED",
      safeResultReference: "result-ref:v1:61000000-0000-4000-8000-000000000002",
    };
    const completed = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ idempotency }) => idempotency.complete(completeCommand),
    );
    assertEqual(
      assertSuccess(completed, "COMPLETE_IDEMPOTENCY").completed,
      true,
      "idempotency completion was not recorded",
    );

    const replay = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ idempotency }) => idempotency.begin(beginCommand),
    );
    const replayValue = assertSuccess(replay, "BEGIN_IDEMPOTENCY");
    assertEqual(
      replayValue.decision,
      "REPLAY",
      "terminal claim did not replay",
    );
    assertEqual(
      replayValue.safeResultReference,
      completeCommand.safeResultReference,
      "idempotency replay changed the safe result reference",
    );

    const conflict = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ idempotency }) =>
        idempotency.begin({
          ...beginCommand,
          canonicalRequestHash: "b".repeat(64),
        }),
    );
    assertEqual(
      assertSuccess(conflict, "BEGIN_IDEMPOTENCY").decision,
      "CONFLICT",
      "same idempotency key accepted a different request hash",
    );
  } finally {
    await persistence.close();
  }

  const applicationNameA = "p1-05-idempotency-concurrent-a";
  const applicationNameB = "p1-05-idempotency-concurrent-b";
  const persistenceA = createPostgresPersistence({
    ...clientConfig,
    application_name: applicationNameA,
  });
  const persistenceB = createPostgresPersistence({
    ...clientConfig,
    application_name: applicationNameB,
  });
  const claimed = deferred();
  const release = deferred();
  const concurrentCommand = {
    schemaVersion: 1,
    operation: "BEGIN_IDEMPOTENCY",
    actor: "actor-ref:v1:worker:61000000-0000-4000-8000-000000000003",
    idempotencyOperation: "inventory.reserve",
    idempotencyKey: "repository-idempotency-concurrent-0001",
    canonicalRequestHash: "c".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  try {
    const first = persistenceA.transactionManager.runInTransaction(
      transactionOptions,
      async ({ idempotency }) => {
        const response = await idempotency.begin(concurrentCommand);
        claimed.resolve();
        await release.promise;
        return response;
      },
    );
    await claimed.promise;
    const second = trackPromise(
      persistenceB.transactionManager.runInTransaction(
        transactionOptions,
        async ({ idempotency }) => idempotency.begin(concurrentCommand),
      ),
    );

    try {
      await observeLockWait(
        observer,
        applicationNameB,
        second.state,
        "concurrent idempotency claim",
      );
    } finally {
      release.resolve();
    }
    const [firstResponse, secondOutcome] = await Promise.all([
      first,
      second.outcome,
    ]);
    if (!secondOutcome.ok) {
      throw secondOutcome.error;
    }
    assertEqual(
      assertSuccess(firstResponse, "BEGIN_IDEMPOTENCY").decision,
      "STARTED",
      "first concurrent claim did not start",
    );
    assertEqual(
      assertSuccess(secondOutcome.value, "BEGIN_IDEMPOTENCY").decision,
      "IN_PROGRESS",
      "second concurrent claim did not replay in-progress state",
    );
  } finally {
    release.resolve();
    await Promise.all([persistenceA.close(), persistenceB.close()]);
  }
}

async function seedCartOutboxSource(client, fixture, includeItem) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO carts (
         id, token_digest, token_pepper_version, presentation_locale,
         market, currency, status, version, expires_at, created_at, updated_at
       ) VALUES (
         $1, decode($2, 'hex'), 'repository-v1', 'en', 'US', 'USD',
         'ACTIVE', 1, '2099-01-01T00:00:00.000Z', $3, $3
       )`,
      [fixture.cartId, fixture.tokenHex, sourceOccurredAt],
    );
    if (includeItem) {
      await client.query(
        `INSERT INTO cart_items (
           id, cart_id, gift_variant_id, observed_price_id, quantity,
           display_mode, has_fan_message, request_id, correlation_id,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 1, 'anonymous', false, $5, $6, $7, $7)`,
        [
          fixture.cartItemId,
          fixture.cartId,
          fixture.giftVariantId,
          fixture.priceId,
          fixture.requestId,
          fixture.correlationId,
          sourceOccurredAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

function cartOutboxCommand(fixture) {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: fixture.eventId,
      eventType: "CART_ITEM_ADDED",
      aggregateId: fixture.cartId,
      occurredAt: sourceOccurredAt,
      correlationId: fixture.correlationId,
      requestId: fixture.requestId,
      payload: {
        cartId: fixture.cartId,
        cartItemId: fixture.cartItemId,
      },
    },
    aggregateVersion: 1,
    primarySubjectId: fixture.cartId,
    secondarySubjectId: fixture.cartItemId,
    market: "US",
    currency: "USD",
    idempotencyKey: fixture.idempotencyKey,
    availableAt: sourceOccurredAt,
  };
}

function cartOutboxCommandWithForeignItem(cartFixture, itemFixture) {
  const command = cartOutboxCommand(cartFixture);
  return {
    ...command,
    event: {
      ...command.event,
      eventId: itemFixture.foreignEventId,
      requestId: itemFixture.requestId,
      correlationId: itemFixture.correlationId,
      payload: {
        cartId: cartFixture.cartId,
        cartItemId: itemFixture.cartItemId,
      },
    },
    secondarySubjectId: itemFixture.cartItemId,
    idempotencyKey: itemFixture.foreignIdempotencyKey,
  };
}

async function seedContentPublicationOutboxSource(client, fixture) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         request_id, correlation_id, outcome, created_at
       ) VALUES (
         $1, 'SYSTEM', 'repository-outbox', 'CONTENT_PUBLISH',
         'CONTENT_PUBLICATION', $2, $3, $4, 'SUCCEEDED', $5
       )`,
      [
        fixture.auditLogId,
        fixture.publicationId,
        fixture.requestId,
        fixture.correlationId,
        sourceOccurredAt,
      ],
    );
    await client.query(
      `INSERT INTO site_locale_config_revisions (
         id, revision, lifecycle, created_by, created_at, validated_at,
         published_at
       ) VALUES ($1, 1, 'PUBLISHED', $2, $3, $3, $3)`,
      [fixture.revisionId, fixture.publishedBy, sourceOccurredAt],
    );
    await client.query(
      `INSERT INTO site_locale_config_entries (
         site_locale_config_revision_id, locale, enabled, sort_order
       ) VALUES ($1, 'en', true, 0)`,
      [fixture.revisionId],
    );
    await client.query(
      `INSERT INTO content_publications (
         id, content_type, site_locale_config_revision_id, action,
         translation_manifest_hash, approval_manifest_hash, published_by,
         published_at, idempotency_key, audit_log_id
       ) VALUES (
         $1, 'SITE_LOCALE_CONFIG', $2, 'PUBLISH', repeat('6', 64),
         repeat('7', 64), $3, $4, $5, $6
       )`,
      [
        fixture.publicationId,
        fixture.revisionId,
        fixture.publishedBy,
        sourceOccurredAt,
        fixture.publicationIdempotencyKey,
        fixture.auditLogId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    fail(
      `content-publication outbox source seed failed (${typeof error?.code === "string" ? error.code : "unknown"})`,
    );
  }
}

function contentPublicationOutboxCommand(
  fixture,
  { locale = "en", secondarySubjectId = fixture.revisionId } = {},
) {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId:
        locale === "en" && secondarySubjectId === fixture.revisionId
          ? fixture.eventId
          : locale === "en"
            ? fixture.wrongRevisionEventId
            : fixture.wrongLocaleEventId,
      eventType: "CONTENT_PUBLICATION_CHANGED",
      aggregateId: fixture.publicationId,
      occurredAt: sourceOccurredAt,
      correlationId: fixture.correlationId,
      requestId: fixture.requestId,
      locale,
      payload: { contentPublicationId: fixture.publicationId },
    },
    aggregateVersion: 1,
    primarySubjectId: fixture.publicationId,
    secondarySubjectId,
    idempotencyKey: `content-publication:${fixture.publicationId}:${locale}`,
    availableAt: sourceOccurredAt,
  };
}

async function seedFulfillmentOutboxSource(client, fixture) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO orders (
         id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
         customer_contact_id, presentation_locale, market, currency,
         quote_revision, quote_expires_at, subtotal_minor, tax_amount_minor,
         shipping_amount_minor, fee_amount_minor, discount_amount_minor,
         total_amount_minor, order_status, payment_status, dispute_status,
         fulfillment_status, version, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'en', 'US', 'USD', 1,
         '2099-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0,
         'DRAFT', 'UNPAID', 'NONE', 'PENDING', 1, $7, $7
       )`,
      [
        fixture.orderId,
        fixture.publicOrderId,
        fixture.checkoutSessionId,
        fixture.checkoutQuoteId,
        fixture.cartId,
        fixture.customerContactId,
        sourceOccurredAt,
      ],
    );
    await client.query(
      `INSERT INTO fulfillments (
         id, order_id, order_item_id, idol_id, fulfillment_profile_id,
         status, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'PREPARING', 2, $6, $6)`,
      [
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.orderItemId,
        fixture.idolId,
        fixture.fulfillmentProfileId,
        sourceOccurredAt,
      ],
    );
    await client.query(
      `INSERT INTO fulfillment_events (
         id, fulfillment_id, order_id, sequence, from_status, to_status,
         authority_kind, reason_code, request_id, correlation_id, occurred_at
       ) VALUES (
         $1, $2, $3, 2, 'PENDING', 'PREPARING', 'WORKER',
         'PREPARATION_STARTED', $4, $5, $6
       )`,
      [
        fixture.fulfillmentEventId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.requestId,
        fixture.correlationId,
        sourceOccurredAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    fail(
      `fulfillment outbox source seed failed (${typeof error?.code === "string" ? error.code : "unknown"})`,
    );
  }
}

function fulfillmentOutboxCommand(fixture, status = "PREPARING") {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: fixture.eventId,
      eventType: "FULFILLMENT_STATUS_CHANGED",
      aggregateId: fixture.fulfillmentId,
      occurredAt: sourceOccurredAt,
      correlationId: fixture.correlationId,
      requestId: fixture.requestId,
      payload: {
        fulfillmentId: fixture.fulfillmentId,
        orderId: fixture.orderId,
        status,
      },
    },
    aggregateVersion: 2,
    primarySubjectId: fixture.fulfillmentId,
    secondarySubjectId: fixture.orderId,
    market: "US",
    currency: "USD",
    idempotencyKey: fixture.idempotencyKey,
    availableAt: sourceOccurredAt,
  };
}

async function advanceFulfillmentOutboxSource(client, fixture) {
  const advancedAt = "2026-01-03T00:00:00.000Z";
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `UPDATE fulfillments
          SET status = 'DELIVERED', version = 3, prepared_at = $2,
              delivered_at = $2, updated_at = $2
        WHERE id = $1`,
      [fixture.fulfillmentId, advancedAt],
    );
    await client.query(
      `INSERT INTO fulfillment_events (
         id, fulfillment_id, order_id, sequence, from_status, to_status,
         authority_kind, reason_code, request_id, correlation_id, occurred_at
       ) VALUES (
         $1, $2, $3, 3, 'PREPARING', 'DELIVERED', 'WORKER',
         'DELIVERY_CONFIRMED', $4, $5, $6
       )`,
      [
        fixture.advancedFulfillmentEventId,
        fixture.fulfillmentId,
        fixture.orderId,
        fixture.advancedRequestId,
        fixture.advancedCorrelationId,
        advancedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    fail(
      `fulfillment outbox source advancement failed (${typeof error?.code === "string" ? error.code : "unknown"})`,
    );
  }
}

async function seedPriceBookOutboxSource(client, fixture) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, actor_id, action, subject_type, subject_id,
         request_id, correlation_id, outcome, created_at
       ) VALUES (
         $1, 'ADMIN', $2, 'PRICE_BOOK_PUBLISH', 'PRICE_BOOK', $3,
         $4, $5, 'SUCCEEDED', $6
       )`,
      [
        fixture.auditLogId,
        fixture.publishedBy,
        fixture.priceBookId,
        fixture.requestId,
        fixture.correlationId,
        sourceOccurredAt,
      ],
    );
    await client.query(
      `INSERT INTO price_book_publications (
         id, price_book_id, price_book_revision, market_id, market, currency,
         action, manifest_hash, published_by, audit_log_id, published_at,
         idempotency_key
       ) VALUES (
         $1, $2, 3, $3, 'US', 'USD', 'PUBLISH', repeat('8', 64),
         $4, $5, $6, $7
       )`,
      [
        fixture.publicationId,
        fixture.priceBookId,
        fixture.marketId,
        fixture.publishedBy,
        fixture.auditLogId,
        sourceOccurredAt,
        fixture.idempotencyKey,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    fail(
      `price-book outbox source seed failed (${typeof error?.code === "string" ? error.code : "unknown"})`,
    );
  }
}

function priceBookOutboxCommand(fixture) {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: fixture.eventId,
      eventType: "PRICE_BOOK_PUBLISHED",
      aggregateId: fixture.priceBookId,
      occurredAt: sourceOccurredAt,
      correlationId: fixture.correlationId,
      requestId: fixture.requestId,
      payload: {
        priceBookPublicationId: fixture.publicationId,
        priceBookId: fixture.priceBookId,
        priceBookRevision: 3,
        market: "US",
        currency: "USD",
      },
    },
    aggregateVersion: 3,
    primarySubjectId: fixture.publicationId,
    secondarySubjectId: fixture.priceBookId,
    market: "US",
    currency: "USD",
    idempotencyKey: fixture.idempotencyKey,
    availableAt: sourceOccurredAt,
  };
}

function recordContradictoryPayloadAcceptance(response, label, accepted) {
  if (
    response.outcome !== "FAILURE" ||
    response.error.code !== "INVALID_COMMAND"
  ) {
    accepted.push(label);
  }
}

async function runOutboxCommand(persistence, command, label) {
  try {
    return await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ outbox }) => outbox.append(command),
    );
  } catch (error) {
    if (error instanceof PersistenceTransactionFailureError) {
      fail(`${label} raised transaction failure ${error.code}`);
    }
    throw error;
  }
}

async function assertOutboxRepository(clientConfig, observer) {
  const persistence = createPostgresPersistence({
    ...clientConfig,
    application_name: "p1-05-outbox",
  });
  const validFixture = Object.freeze({
    cartId: "62000000-0000-4000-8000-000000000001",
    cartItemId: "62000000-0000-4000-8000-000000000002",
    giftVariantId: "62000000-0000-4000-8000-000000000003",
    priceId: "62000000-0000-4000-8000-000000000004",
    requestId: "62000000-0000-4000-8000-000000000005",
    correlationId: "62000000-0000-4000-8000-000000000006",
    eventId: "62000000-0000-4000-8000-000000000007",
    tokenHex: "d".repeat(64),
    idempotencyKey: "repository-outbox-valid-0001",
  });
  const invalidFixture = Object.freeze({
    cartId: "62000000-0000-4000-8000-000000000011",
    cartItemId: "62000000-0000-4000-8000-000000000012",
    giftVariantId: "62000000-0000-4000-8000-000000000013",
    priceId: "62000000-0000-4000-8000-000000000014",
    requestId: "62000000-0000-4000-8000-000000000015",
    correlationId: "62000000-0000-4000-8000-000000000016",
    eventId: "62000000-0000-4000-8000-000000000017",
    wrongRequestId: "62000000-0000-4000-8000-000000000018",
    tokenHex: "e".repeat(64),
    idempotencyKey: "repository-outbox-invalid-0001",
  });
  const foreignItemFixture = Object.freeze({
    cartId: "62000000-0000-4000-8000-000000000021",
    cartItemId: "62000000-0000-4000-8000-000000000022",
    giftVariantId: "62000000-0000-4000-8000-000000000023",
    priceId: "62000000-0000-4000-8000-000000000024",
    requestId: "62000000-0000-4000-8000-000000000025",
    correlationId: "62000000-0000-4000-8000-000000000026",
    eventId: "62000000-0000-4000-8000-000000000027",
    foreignEventId: "62000000-0000-4000-8000-000000000028",
    tokenHex: "f".repeat(64),
    idempotencyKey: "repository-outbox-foreign-source-0001",
    foreignIdempotencyKey: "repository-outbox-cross-cart-0001",
  });
  const contentFixture = Object.freeze({
    publicationId: "62300000-0000-4000-8000-000000000001",
    revisionId: "62300000-0000-4000-8000-000000000002",
    wrongRevisionId: "62300000-0000-4000-8000-000000000003",
    publishedBy: "62300000-0000-4000-8000-000000000004",
    auditLogId: "62300000-0000-4000-8000-000000000005",
    requestId: "62300000-0000-4000-8000-000000000006",
    correlationId: "62300000-0000-4000-8000-000000000007",
    eventId: "62300000-0000-4000-8000-000000000008",
    wrongRevisionEventId: "62300000-0000-4000-8000-000000000009",
    wrongLocaleEventId: "62300000-0000-4000-8000-000000000010",
    publicationIdempotencyKey: "repository-content-publication-0001",
  });
  const fulfillmentFixture = Object.freeze({
    fulfillmentId: "62100000-0000-4000-8000-000000000001",
    orderId: "62100000-0000-4000-8000-000000000002",
    publicOrderId: "62100000-0000-4000-8000-000000000003",
    checkoutSessionId: "62100000-0000-4000-8000-000000000004",
    checkoutQuoteId: "62100000-0000-4000-8000-000000000005",
    cartId: "62100000-0000-4000-8000-000000000006",
    customerContactId: "62100000-0000-4000-8000-000000000007",
    orderItemId: "62100000-0000-4000-8000-000000000008",
    idolId: "62100000-0000-4000-8000-000000000009",
    fulfillmentProfileId: "62100000-0000-4000-8000-000000000010",
    fulfillmentEventId: "62100000-0000-4000-8000-000000000011",
    requestId: "62100000-0000-4000-8000-000000000012",
    correlationId: "62100000-0000-4000-8000-000000000013",
    eventId: "62100000-0000-4000-8000-000000000014",
    advancedFulfillmentEventId: "62100000-0000-4000-8000-000000000015",
    advancedRequestId: "62100000-0000-4000-8000-000000000016",
    advancedCorrelationId: "62100000-0000-4000-8000-000000000017",
    idempotencyKey: "repository-outbox-fulfillment-0001",
  });
  const priceBookFixture = Object.freeze({
    priceBookId: "62200000-0000-4000-8000-000000000001",
    publicationId: "62200000-0000-4000-8000-000000000002",
    marketId: "62200000-0000-4000-8000-000000000003",
    publishedBy: "62200000-0000-4000-8000-000000000004",
    auditLogId: "62200000-0000-4000-8000-000000000005",
    requestId: "62200000-0000-4000-8000-000000000006",
    correlationId: "62200000-0000-4000-8000-000000000007",
    eventId: "62200000-0000-4000-8000-000000000008",
    idempotencyKey:
      "price-book-publication:62200000-0000-4000-8000-000000000002",
  });

  try {
    await seedCartOutboxSource(observer, validFixture, true);
    const validCommand = cartOutboxCommand(validFixture);
    const appended = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ outbox }) => outbox.append(validCommand),
    );
    const appendValue = assertSuccess(appended, "APPEND_OUTBOX_EVENT");
    assertEqual(appendValue.appended, true, "outbox event was not appended");
    assertEqual(
      appendValue.eventId,
      validFixture.eventId,
      "outbox event identity changed",
    );

    const driftedReplay = await persistence.transactionManager.runInTransaction(
      transactionOptions,
      async ({ outbox }) =>
        outbox.append({
          ...validCommand,
          availableAt: "2026-01-03T00:00:00.000Z",
        }),
    );
    assertEqual(
      driftedReplay.outcome,
      "FAILURE",
      "outbox replay accepted drifted durable fields",
    );
    assertEqual(
      driftedReplay.error.code,
      "IDEMPOTENCY_CONFLICT",
      "outbox replay drift returned the wrong stable failure",
    );

    const stored = await observer.query(
      `SELECT aggregate_type, locale, market, currency
         FROM outbox_events
        WHERE id = $1`,
      [validFixture.eventId],
    );
    assertEqual(stored.rows.length, 1, "outbox event was not persisted");
    assertEqual(
      stored.rows[0].aggregate_type,
      "CART",
      "aggregate type mismatch",
    );
    assertEqual(
      stored.rows[0].locale,
      "en",
      "outbox locale was not authoritative",
    );

    await seedCartOutboxSource(observer, foreignItemFixture, true);
    const crossCart = await runOutboxCommand(
      persistence,
      cartOutboxCommandWithForeignItem(validFixture, foreignItemFixture),
      "cross-cart outbox item",
    );
    assertEqual(
      crossCart.outcome,
      "FAILURE",
      "outbox accepted an item owned by a different cart",
    );
    assertEqual(
      crossCart.error.code,
      "NOT_FOUND",
      "cross-cart outbox item returned the wrong stable failure",
    );

    await seedContentPublicationOutboxSource(observer, contentFixture);
    const wrongContentRevision = await runOutboxCommand(
      persistence,
      contentPublicationOutboxCommand(contentFixture, {
        secondarySubjectId: contentFixture.wrongRevisionId,
      }),
      "wrong content-publication revision",
    );
    assertEqual(
      wrongContentRevision.outcome,
      "FAILURE",
      "content outbox accepted the wrong published revision",
    );
    assertEqual(
      wrongContentRevision.error.code,
      "INVALID_COMMAND",
      "wrong content-publication revision returned the wrong failure",
    );
    const wrongContentLocale = await runOutboxCommand(
      persistence,
      contentPublicationOutboxCommand(contentFixture, { locale: "es" }),
      "wrong content-publication locale",
    );
    assertEqual(
      wrongContentLocale.outcome,
      "FAILURE",
      "content outbox accepted a locale absent from the publication",
    );
    assertEqual(
      wrongContentLocale.error.code,
      "NOT_FOUND",
      "wrong content-publication locale returned the wrong failure",
    );
    assertSuccess(
      await runOutboxCommand(
        persistence,
        contentPublicationOutboxCommand(contentFixture),
        "canonical content-publication event",
      ),
      "APPEND_OUTBOX_EVENT",
    );

    await seedFulfillmentOutboxSource(observer, fulfillmentFixture);
    await seedPriceBookOutboxSource(observer, priceBookFixture);
    const contradictoryPayloadsAccepted = [];
    const invalidFulfillmentStatus = fulfillmentOutboxCommand(
      fulfillmentFixture,
      "DELIVERED",
    );
    recordContradictoryPayloadAcceptance(
      await runOutboxCommand(
        persistence,
        invalidFulfillmentStatus,
        "contradictory fulfillment payload",
      ),
      "fulfillment status",
      contradictoryPayloadsAccepted,
    );

    const canonicalPriceBook = priceBookOutboxCommand(priceBookFixture);
    for (const [label, payload] of [
      [
        "price-book revision",
        { ...canonicalPriceBook.event.payload, priceBookRevision: 4 },
      ],
      [
        "price-book market",
        { ...canonicalPriceBook.event.payload, market: "CA" },
      ],
      [
        "price-book currency",
        { ...canonicalPriceBook.event.payload, currency: "EUR" },
      ],
    ]) {
      recordContradictoryPayloadAcceptance(
        await runOutboxCommand(
          persistence,
          {
            ...canonicalPriceBook,
            event: { ...canonicalPriceBook.event, payload },
          },
          `contradictory ${label} payload`,
        ),
        label,
        contradictoryPayloadsAccepted,
      );
    }
    if (contradictoryPayloadsAccepted.length > 0) {
      fail(
        `outbox authority accepted contradictory payloads: ${contradictoryPayloadsAccepted.join(", ")}`,
      );
    }

    for (const [eventId, label] of [
      [fulfillmentFixture.eventId, "fulfillment"],
      [priceBookFixture.eventId, "price-book"],
    ]) {
      const rejected = await observer.query(
        "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
        [eventId],
      );
      assertEqual(
        rejected.rows[0]?.count,
        0,
        `${label} contradictory payload was persisted`,
      );
    }

    const canonicalFulfillment = fulfillmentOutboxCommand(fulfillmentFixture);
    assertSuccess(
      await runOutboxCommand(
        persistence,
        canonicalFulfillment,
        "canonical fulfillment payload",
      ),
      "APPEND_OUTBOX_EVENT",
    );
    assertSuccess(
      await runOutboxCommand(
        persistence,
        canonicalPriceBook,
        "canonical price-book payload",
      ),
      "APPEND_OUTBOX_EVENT",
    );
    const storedFulfillmentEvent = await observer.query(
      `SELECT event_type, aggregate_id::text, aggregate_version::text,
              primary_subject_id::text, secondary_subject_id::text,
              payload_status
         FROM outbox_events
        WHERE id = $1`,
      [fulfillmentFixture.eventId],
    );
    assertEqual(
      storedFulfillmentEvent.rows[0]?.payload_status,
      "PREPARING",
      "durable outbox row could not reconstruct the original status payload",
    );
    await advanceFulfillmentOutboxSource(observer, fulfillmentFixture);
    assertSuccess(
      await runOutboxCommand(
        persistence,
        canonicalFulfillment,
        "fulfillment replay after aggregate advancement",
      ),
      "APPEND_OUTBOX_EVENT",
    );
    const statusAfterAdvancement = await observer.query(
      "SELECT payload_status FROM outbox_events WHERE id = $1",
      [fulfillmentFixture.eventId],
    );
    assertEqual(
      statusAfterAdvancement.rows[0]?.payload_status,
      "PREPARING",
      "aggregate advancement rewrote the durable outbox status",
    );
    for (const [label, command] of [
      ["fulfillment status replay", invalidFulfillmentStatus],
      [
        "price-book revision replay",
        {
          ...canonicalPriceBook,
          event: {
            ...canonicalPriceBook.event,
            payload: {
              ...canonicalPriceBook.event.payload,
              priceBookRevision: 4,
            },
          },
        },
      ],
    ]) {
      const replay = await runOutboxCommand(persistence, command, label);
      assertEqual(replay.outcome, "FAILURE", `${label} accepted payload drift`);
      assertEqual(
        replay.error.code,
        "IDEMPOTENCY_CONFLICT",
        `${label} returned the wrong stable failure`,
      );
    }

    await seedCartOutboxSource(observer, invalidFixture, true);
    let deferredFailure;
    try {
      await persistence.transactionManager.runInTransaction(
        transactionOptions,
        async ({ outbox }) => {
          const command = cartOutboxCommand(invalidFixture);
          return outbox.append({
            ...command,
            event: {
              ...command.event,
              requestId: invalidFixture.wrongRequestId,
            },
          });
        },
      );
    } catch (error) {
      deferredFailure = error;
    }
    if (!(deferredFailure instanceof PersistenceTransactionFailureError)) {
      fail("deferred outbox authority failure escaped without normalization");
    }
    assertEqual(
      deferredFailure.code,
      "INTEGRITY_VIOLATION",
      "deferred outbox failure classification mismatch",
    );
    if (
      deferredFailure.message.includes("constraint") ||
      deferredFailure.message.includes("outbox event has no exact")
    ) {
      fail("deferred database details crossed the adapter boundary");
    }
    const rolledBack = await observer.query(
      "SELECT count(*)::integer AS count FROM outbox_events WHERE id = $1",
      [invalidFixture.eventId],
    );
    assertEqual(
      rolledBack.rows[0]?.count,
      0,
      "commit-time failure did not roll back the outbox insert",
    );
  } finally {
    await persistence.close();
  }
}

function inventoryFixture(offset, options = {}) {
  const suffix = (value) => String(offset + value).padStart(12, "0");
  return Object.freeze({
    giftId: `63000000-0000-4000-8000-${suffix(1)}`,
    giftVariantId: `63000000-0000-4000-8000-${suffix(2)}`,
    inventoryItemId: `63000000-0000-4000-8000-${suffix(3)}`,
    inventoryLocationId: `63000000-0000-4000-8000-${suffix(4)}`,
    cartId: `63000000-0000-4000-8000-${suffix(5)}`,
    cartItemId: `63000000-0000-4000-8000-${suffix(6)}`,
    checkoutSessionId: `63000000-0000-4000-8000-${suffix(7)}`,
    checkoutQuoteId: `63000000-0000-4000-8000-${suffix(8)}`,
    orderId: `63000000-0000-4000-8000-${suffix(9)}`,
    publicOrderId: `63000000-0000-4000-8000-${suffix(10)}`,
    customerContactId: `63000000-0000-4000-8000-${suffix(11)}`,
    priceId: `63000000-0000-4000-8000-${suffix(12)}`,
    requestId: `63000000-0000-4000-8000-${suffix(13)}`,
    correlationId: `63000000-0000-4000-8000-${suffix(14)}`,
    reservationId: `63000000-0000-4000-8000-${suffix(15)}`,
    initializeLedgerId: `63000000-0000-4000-8000-${suffix(16)}`,
    creationLedgerId: `63000000-0000-4000-8000-${suffix(17)}`,
    transitionLedgerId: `63000000-0000-4000-8000-${suffix(18)}`,
    checkoutQuoteLineId: `63000000-0000-4000-8000-${suffix(19)}`,
    sku: `REPOSITORY-${String(offset + 1)}`,
    locationCode: `REPOSITORY_${String(offset + 1)}`,
    tokenHex: String(offset + 1).padStart(64, "0"),
    onHand: options.onHand ?? 10,
    reserved: options.reserved ?? 0,
    balanceVersion: options.balanceVersion ?? 1,
    reservationExpiresAt:
      options.reservationExpiresAt ?? "2099-01-01T00:00:00.000Z",
  });
}

async function seedInventorySource(client, fixture, includeReservation) {
  const createdAt = "2025-01-01T00:00:00.000Z";
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO gift_variants (
         id, gift_id, sku, status, inventory_policy, version, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', 'TRACKED', 1, $4, $4)`,
      [fixture.giftVariantId, fixture.giftId, fixture.sku, createdAt],
    );
    await client.query(
      `INSERT INTO inventory_locations (id, location_key, status, created_at)
       VALUES ($1, $2, 'ACTIVE', $3)`,
      [fixture.inventoryLocationId, fixture.locationCode, createdAt],
    );
    await client.query(
      `INSERT INTO inventory_items (
         id, gift_variant_id, sku, policy, status, created_at
       ) VALUES ($1, $2, $3, 'TRACKED', 'ACTIVE', $4)`,
      [fixture.inventoryItemId, fixture.giftVariantId, fixture.sku, createdAt],
    );
    await client.query(
      `INSERT INTO inventory_balances (
         inventory_item_id, location_id, on_hand, reserved, version, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fixture.inventoryItemId,
        fixture.inventoryLocationId,
        fixture.onHand,
        fixture.reserved,
        fixture.balanceVersion,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO carts (
         id, token_digest, token_pepper_version, presentation_locale,
         market, currency, status, version, expires_at, created_at, updated_at,
         locked_order_id
       ) VALUES (
         $1, decode($2, 'hex'), 'repository-inventory-v1', 'en', 'US', 'USD',
         'LOCKED', 1, '2099-01-01T00:00:00.000Z', $3, $3, $4
       )`,
      [fixture.cartId, fixture.tokenHex, createdAt, fixture.orderId],
    );
    await client.query(
      `INSERT INTO cart_items (
         id, cart_id, gift_variant_id, observed_price_id, quantity,
         display_mode, has_fan_message, request_id, correlation_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 2, 'anonymous', false, $5, $6, $7, $7)`,
      [
        fixture.cartItemId,
        fixture.cartId,
        fixture.giftVariantId,
        fixture.priceId,
        fixture.requestId,
        fixture.correlationId,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO checkout_sessions (
         id, cart_id, quote_id, cart_version, status, market, currency,
         quote_revision, quote_expires_at, subtotal_minor, tax_amount_minor,
         shipping_amount_minor, fee_amount_minor, discount_amount_minor,
         total_amount_minor, created_at, expires_at, updated_at
       ) VALUES (
         $1, $2, $3, 1, 'READY', 'US', 'USD', 1,
         '2099-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, $4,
         '2099-01-01T00:00:00.000Z', $4
       )`,
      [
        fixture.checkoutSessionId,
        fixture.cartId,
        fixture.checkoutQuoteId,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO checkout_quote_lines (
         id, checkout_session_id, checkout_quote_id, cart_item_id,
         gift_variant_id, price_id, price_revision, quantity,
         unit_amount_minor, line_subtotal_minor, tax_amount_minor,
         discount_amount_minor, line_total_minor
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, 2, 0, 0, 0, 0, 0)`,
      [
        fixture.checkoutQuoteLineId,
        fixture.checkoutSessionId,
        fixture.checkoutQuoteId,
        fixture.cartItemId,
        fixture.giftVariantId,
        fixture.priceId,
      ],
    );
    await client.query(
      `INSERT INTO orders (
         id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
         customer_contact_id, presentation_locale, market, currency,
         quote_revision, quote_expires_at, subtotal_minor, tax_amount_minor,
         shipping_amount_minor, fee_amount_minor, discount_amount_minor,
         total_amount_minor, order_status, payment_status, dispute_status,
         fulfillment_status, version, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'en', 'US', 'USD', 1,
         '2099-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0,
         'DRAFT', 'UNPAID', 'NONE', 'PENDING', 1, $7, $7
       )`,
      [
        fixture.orderId,
        fixture.publicOrderId,
        fixture.checkoutSessionId,
        fixture.checkoutQuoteId,
        fixture.cartId,
        fixture.customerContactId,
        createdAt,
      ],
    );
    if (includeReservation) {
      await client.query(
        `INSERT INTO inventory_reservations (
           id, inventory_item_id, gift_variant_id, location_id,
           checkout_session_id, checkout_quote_id, cart_item_id,
           locked_order_id, quantity, status, version, expires_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 2, 'ACTIVE', 1, $9, $10, $10
         )`,
        [
          fixture.reservationId,
          fixture.inventoryItemId,
          fixture.giftVariantId,
          fixture.inventoryLocationId,
          fixture.checkoutSessionId,
          fixture.checkoutQuoteId,
          fixture.cartItemId,
          fixture.orderId,
          fixture.reservationExpiresAt,
          createdAt,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_ledger (
         id, inventory_item_id, location_id, reservation_id,
         balance_version_before, balance_version_after, delta_on_hand,
         delta_reserved, reason_code, source_type, source_id,
         idempotency_key, actor_kind, task_name, occurred_at
       ) VALUES (
         $1, $2, $3, null, 0, 1, $4, 0, 'INITIALIZE', 'ADJUSTMENT', $2,
         $5, 'SYSTEM', 'repository.inventory.seed', $6
       )`,
      [
        fixture.initializeLedgerId,
        fixture.inventoryItemId,
        fixture.inventoryLocationId,
        fixture.onHand,
        `repository-inventory-initialize-${fixture.inventoryItemId}`,
        createdAt,
      ],
    );
    if (includeReservation) {
      await client.query(
        `INSERT INTO inventory_ledger (
           id, inventory_item_id, location_id, reservation_id,
           balance_version_before, balance_version_after, delta_on_hand,
           delta_reserved, reason_code, source_type, source_id,
           idempotency_key, actor_kind, task_name, occurred_at
         ) VALUES (
           $1, $2, $3, $4, 1, 2, 0, 2, 'RESERVATION_CREATED',
           'RESERVATION', $4, $5, 'SYSTEM', 'repository.inventory.seed', $6
         )`,
        [
          fixture.creationLedgerId,
          fixture.inventoryItemId,
          fixture.inventoryLocationId,
          fixture.reservationId,
          `repository-inventory-reserved-${fixture.inventoryItemId}`,
          createdAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function seedCrossCartItem(client, fixture) {
  const rogueCartId = "63000000-0000-4000-8000-000000009001";
  const rogueCartItemId = "63000000-0000-4000-8000-000000009002";
  const createdAt = "2025-01-01T00:00:00.000Z";
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO carts (
         id, token_digest, token_pepper_version, presentation_locale,
         market, currency, status, version, expires_at, created_at, updated_at
       ) VALUES (
         $1, decode($2, 'hex'), 'repository-cross-cart-v1', 'en', 'US', 'USD',
         'ACTIVE', 1, '2099-01-01T00:00:00.000Z', $3, $3
       )`,
      [rogueCartId, "9".repeat(64), createdAt],
    );
    await client.query(
      `INSERT INTO cart_items (
         id, cart_id, gift_variant_id, observed_price_id, quantity,
         display_mode, has_fan_message, request_id, correlation_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 2, 'anonymous', false, $5, $6, $7, $7)`,
      [
        rogueCartItemId,
        rogueCartId,
        fixture.giftVariantId,
        fixture.priceId,
        "63000000-0000-4000-8000-000000009003",
        "63000000-0000-4000-8000-000000009004",
        createdAt,
      ],
    );
    await client.query("COMMIT");
    return rogueCartItemId;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

function inventoryItemSnapshot(fixture) {
  return {
    schemaVersion: 1,
    id: fixture.inventoryItemId,
    giftVariantId: fixture.giftVariantId,
    sku: fixture.sku,
    policy: "TRACKED",
    status: "ACTIVE",
  };
}

function inventoryBalanceSnapshot(fixture, reserved, version) {
  return {
    schemaVersion: 1,
    inventoryItemId: fixture.inventoryItemId,
    inventoryLocationId: fixture.inventoryLocationId,
    onHand: fixture.onHand,
    reserved,
    version,
  };
}

function inventoryReservationSnapshot(fixture, status, version) {
  return {
    schemaVersion: 1,
    id: fixture.reservationId,
    checkoutQuoteId: fixture.checkoutQuoteId,
    cartItemId: fixture.cartItemId,
    giftVariantId: fixture.giftVariantId,
    inventoryLocationId: fixture.inventoryLocationId,
    quantity: 2,
    status,
    expiresAt: fixture.reservationExpiresAt,
    version,
  };
}

function inventoryCreationCommand(fixture) {
  const previousBalance = inventoryBalanceSnapshot(fixture, 0, 1);
  const nextBalance = inventoryBalanceSnapshot(fixture, 2, 2);
  const nextReservation = inventoryReservationSnapshot(fixture, "ACTIVE", 1);
  return {
    schemaVersion: 1,
    operation: "APPLY_INVENTORY_RESERVATION_CREATION",
    decision: {
      schemaVersion: 1,
      kind: "APPLY",
      inventoryItem: inventoryItemSnapshot(fixture),
      inventoryItemId: fixture.inventoryItemId,
      inventoryLocationId: fixture.inventoryLocationId,
      reservationId: fixture.reservationId,
      expectedBalanceVersion: 1,
      expectedReservationAbsent: true,
      previousBalance,
      nextBalance,
      nextReservation,
      ledgerDelta: { deltaOnHand: 0, deltaReserved: 2 },
      reasonCode: "RESERVATION_CREATED",
    },
    ledgerEntry: {
      schemaVersion: 1,
      id: fixture.creationLedgerId,
      inventoryItemId: fixture.inventoryItemId,
      inventoryLocationId: fixture.inventoryLocationId,
      deltaOnHand: 0,
      deltaReserved: 2,
      reasonCode: "RESERVATION_CREATED",
      idempotencyKey: `repository-inventory-create-${fixture.inventoryItemId}`,
      actor: { kind: "SYSTEM", taskName: "repository.inventory.reserve" },
      occurredAt: "2026-09-03T00:00:00.000Z",
    },
  };
}

function inventoryCreationCommandWithEquivalentRepresentations(fixture) {
  const command = inventoryCreationCommand(fixture);
  const upper = (value) => value.toUpperCase();
  const balance = (value) => ({
    ...value,
    inventoryItemId: upper(value.inventoryItemId),
    inventoryLocationId: upper(value.inventoryLocationId),
  });
  const reservation = {
    ...command.decision.nextReservation,
    id: upper(command.decision.nextReservation.id),
    checkoutQuoteId: upper(command.decision.nextReservation.checkoutQuoteId),
    cartItemId: upper(command.decision.nextReservation.cartItemId),
    giftVariantId: upper(command.decision.nextReservation.giftVariantId),
    inventoryLocationId: upper(
      command.decision.nextReservation.inventoryLocationId,
    ),
    expiresAt: "2099-01-01T01:00:00.000+01:00",
  };
  return {
    ...command,
    decision: {
      ...command.decision,
      inventoryItem: {
        ...command.decision.inventoryItem,
        id: upper(command.decision.inventoryItem.id),
        giftVariantId: upper(command.decision.inventoryItem.giftVariantId),
      },
      inventoryItemId: upper(command.decision.inventoryItemId),
      inventoryLocationId: upper(command.decision.inventoryLocationId),
      reservationId: upper(command.decision.reservationId),
      previousBalance: balance(command.decision.previousBalance),
      nextBalance: balance(command.decision.nextBalance),
      nextReservation: reservation,
    },
    ledgerEntry: {
      ...command.ledgerEntry,
      id: upper(command.ledgerEntry.id),
      inventoryItemId: upper(command.ledgerEntry.inventoryItemId),
      inventoryLocationId: upper(command.ledgerEntry.inventoryLocationId),
      occurredAt: "2026-09-03T01:00:00.000+01:00",
    },
  };
}

function inventoryExpirationCommand(fixture) {
  const previousBalance = inventoryBalanceSnapshot(fixture, 2, 2);
  const nextBalance = inventoryBalanceSnapshot(fixture, 0, 3);
  const previousReservation = inventoryReservationSnapshot(
    fixture,
    "ACTIVE",
    1,
  );
  const nextReservation = inventoryReservationSnapshot(fixture, "EXPIRED", 2);
  return {
    schemaVersion: 1,
    operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
    decision: {
      schemaVersion: 1,
      kind: "APPLY",
      inventoryItem: inventoryItemSnapshot(fixture),
      inventoryItemId: fixture.inventoryItemId,
      inventoryLocationId: fixture.inventoryLocationId,
      reservationId: fixture.reservationId,
      expectedBalanceVersion: 2,
      expectedReservationVersion: 1,
      previousBalance,
      previousReservation,
      nextBalance,
      nextReservation,
      ledgerDelta: { deltaOnHand: 0, deltaReserved: -2 },
      reasonCode: "RESERVATION_EXPIRED",
    },
    ledgerEntry: {
      schemaVersion: 1,
      id: fixture.transitionLedgerId,
      inventoryItemId: fixture.inventoryItemId,
      inventoryLocationId: fixture.inventoryLocationId,
      deltaOnHand: 0,
      deltaReserved: -2,
      reasonCode: "RESERVATION_EXPIRED",
      idempotencyKey: `repository-inventory-expire-${fixture.inventoryItemId}`,
      actor: { kind: "SYSTEM", taskName: "repository.inventory.expire" },
      occurredAt: "2026-09-03T00:00:00.000Z",
    },
  };
}

async function assertInventoryRepository(clientConfig, observer) {
  const fresh = inventoryFixture(1000);
  const canonicalEquivalence = Object.freeze({
    ...inventoryFixture(5000),
    giftVariantId: "63abcdef-0000-4000-8000-000000005002",
    inventoryItemId: "63abcdee-0000-4000-8000-000000005003",
    inventoryLocationId: "63abcded-0000-4000-8000-000000005004",
    cartItemId: "63abcdec-0000-4000-8000-000000005006",
    checkoutQuoteId: "63abcdeb-0000-4000-8000-000000005008",
    reservationId: "63abcdea-0000-4000-8000-000000005015",
    creationLedgerId: "63abcdef-0000-4000-8000-000000005017",
  });
  const expiring = inventoryFixture(2000, {
    onHand: 5,
    reserved: 2,
    balanceVersion: 2,
    reservationExpiresAt: "2025-02-01T00:00:00.000Z",
  });
  const pausedDuringCreation = inventoryFixture(3000);
  const prematureExpiry = inventoryFixture(4000, {
    onHand: 5,
    reserved: 2,
    balanceVersion: 2,
    reservationExpiresAt: "2099-02-01T00:00:00.000Z",
  });
  await seedInventorySource(observer, fresh, false);
  await seedInventorySource(observer, canonicalEquivalence, false);
  await seedInventorySource(observer, expiring, true);
  await seedInventorySource(observer, pausedDuringCreation, false);
  await seedInventorySource(observer, prematureExpiry, true);
  const crossCartItemId = await seedCrossCartItem(observer, fresh);

  const main = createPostgresPersistence({
    ...clientConfig,
    application_name: "p1-05-inventory-main",
  });
  try {
    const equivalentCreation = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationCreation(
          inventoryCreationCommandWithEquivalentRepresentations(
            canonicalEquivalence,
          ),
        ),
    );
    const equivalentValue = assertSuccess(
      equivalentCreation,
      "APPLY_INVENTORY_RESERVATION_CREATION",
    );
    assertEqual(
      equivalentValue.balance.inventoryItemId,
      canonicalEquivalence.inventoryItemId,
      "equivalent UUID input did not return the database canonical form",
    );
    assertEqual(
      equivalentValue.reservation.expiresAt,
      canonicalEquivalence.reservationExpiresAt,
      "equivalent timestamp input did not return the database canonical form",
    );
    assertEqual(
      equivalentValue.ledgerEntry.occurredAt,
      "2026-09-03T00:00:00.000Z",
      "ledger timestamp did not return the database canonical form",
    );

    const loaded = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.loadManyForUpdate({
          schemaVersion: 1,
          operation: "LOAD_INVENTORY_FOR_UPDATE",
          targets: [
            {
              inventoryItemId: expiring.inventoryItemId,
              inventoryLocationId: expiring.inventoryLocationId,
              reservationId: expiring.reservationId,
            },
            {
              inventoryItemId: fresh.inventoryItemId,
              inventoryLocationId: fresh.inventoryLocationId,
            },
          ],
        }),
    );
    const loadedItems = assertSuccess(
      loaded,
      "LOAD_INVENTORY_FOR_UPDATE",
    ).items;
    assertEqual(loadedItems.length, 2, "inventory lock set was incomplete");
    assertEqual(
      loadedItems[0].inventoryItem.id,
      fresh.inventoryItemId,
      "inventory locks were not returned in stable item/location order",
    );
    assertEqual(
      loadedItems[1].reservation.id,
      expiring.reservationId,
      "requested reservation was not locked with its balance",
    );

    const beforePause = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.loadManyForUpdate({
          schemaVersion: 1,
          operation: "LOAD_INVENTORY_FOR_UPDATE",
          targets: [
            {
              inventoryItemId: pausedDuringCreation.inventoryItemId,
              inventoryLocationId: pausedDuringCreation.inventoryLocationId,
            },
          ],
        }),
    );
    assertEqual(
      assertSuccess(beforePause, "LOAD_INVENTORY_FOR_UPDATE").items[0]
        ?.inventoryLocation.status,
      "ACTIVE",
      "creation fixture did not start at an active location",
    );
    await observer.query(
      "UPDATE inventory_locations SET status = 'PAUSED' WHERE id = $1",
      [pausedDuringCreation.inventoryLocationId],
    );

    const staleCreation = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationCreation(
          inventoryCreationCommand(pausedDuringCreation),
        ),
    );
    const prematureTransition = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationTransition(
          inventoryExpirationCommand(prematureExpiry),
        ),
    );
    const acceptedAuthorityViolations = [];
    for (const [label, response] of [
      ["paused-location reservation creation", staleCreation],
      ["premature reservation expiry", prematureTransition],
    ]) {
      if (
        response.outcome !== "FAILURE" ||
        response.error.code !== "VERSION_CONFLICT"
      ) {
        acceptedAuthorityViolations.push(label);
      }
    }
    if (acceptedAuthorityViolations.length > 0) {
      fail(
        `inventory authority accepted stale decisions: ${acceptedAuthorityViolations.join(", ")}`,
      );
    }

    const authorityState = await observer.query(
      `SELECT balance.inventory_item_id,
              balance.reserved,
              balance.version,
              (SELECT count(*)::integer
                 FROM inventory_reservations reservation
                WHERE reservation.inventory_item_id = balance.inventory_item_id)
                AS reservation_count,
              (SELECT max(reservation.status)
                 FROM inventory_reservations reservation
                WHERE reservation.inventory_item_id = balance.inventory_item_id)
                AS reservation_status,
              (SELECT count(*)::integer
                 FROM inventory_ledger ledger
                WHERE ledger.inventory_item_id = balance.inventory_item_id)
                AS ledger_count
         FROM inventory_balances balance
        WHERE balance.inventory_item_id IN ($1, $2)
        ORDER BY balance.inventory_item_id`,
      [pausedDuringCreation.inventoryItemId, prematureExpiry.inventoryItemId],
    );
    const pausedState = authorityState.rows.find(
      (row) => row.inventory_item_id === pausedDuringCreation.inventoryItemId,
    );
    const prematureState = authorityState.rows.find(
      (row) => row.inventory_item_id === prematureExpiry.inventoryItemId,
    );
    assertEqual(pausedState?.reserved, "0", "paused creation changed balance");
    assertEqual(pausedState?.version, "1", "paused creation advanced version");
    assertEqual(
      pausedState?.reservation_count,
      0,
      "paused creation persisted a reservation",
    );
    assertEqual(pausedState?.ledger_count, 1, "paused creation wrote a ledger");
    assertEqual(
      prematureState?.reserved,
      "2",
      "premature expiry released inventory",
    );
    assertEqual(
      prematureState?.version,
      "2",
      "premature expiry advanced balance",
    );
    assertEqual(
      prematureState?.reservation_status,
      "ACTIVE",
      "premature expiry changed reservation status",
    );
    assertEqual(
      prematureState?.ledger_count,
      2,
      "premature expiry wrote a terminal ledger",
    );

    const canonicalCreation = inventoryCreationCommand(fresh);
    const crossCartCreation = {
      ...canonicalCreation,
      decision: {
        ...canonicalCreation.decision,
        nextReservation: {
          ...canonicalCreation.decision.nextReservation,
          cartItemId: crossCartItemId,
        },
      },
    };
    const rejectedCrossCart = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationCreation(crossCartCreation),
    );
    assertEqual(
      rejectedCrossCart.outcome,
      "FAILURE",
      "reservation accepted a cart item outside the canonical checkout",
    );
    assertEqual(
      rejectedCrossCart.error.code,
      "INTEGRITY_VIOLATION",
      "cross-cart reservation returned the wrong stable failure",
    );

    const partialMutationAttempt = {
      ...canonicalCreation,
      ledgerEntry: {
        ...canonicalCreation.ledgerEntry,
        id: fresh.initializeLedgerId,
        idempotencyKey: `repository-inventory-partial-${fresh.inventoryItemId}`,
      },
    };
    const rolledBackFailure = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationCreation(partialMutationAttempt),
    );
    assertEqual(
      rolledBackFailure.outcome,
      "FAILURE",
      "duplicate ledger evidence unexpectedly succeeded",
    );
    assertEqual(
      rolledBackFailure.error.code,
      "ALREADY_EXISTS",
      "duplicate ledger evidence returned the wrong stable failure",
    );
    const afterFailure = await observer.query(
      `SELECT balance.reserved, balance.version,
              (SELECT count(*)::integer FROM inventory_reservations reservation
                WHERE reservation.id = $3) AS reservation_count,
              (SELECT count(*)::integer FROM inventory_ledger ledger
                WHERE ledger.inventory_item_id = balance.inventory_item_id
                  AND ledger.location_id = balance.location_id) AS ledger_count
         FROM inventory_balances balance
        WHERE balance.inventory_item_id = $1 AND balance.location_id = $2`,
      [fresh.inventoryItemId, fresh.inventoryLocationId, fresh.reservationId],
    );
    assertEqual(
      afterFailure.rows[0]?.reserved,
      "0",
      "failure response left a partial balance mutation",
    );
    assertEqual(
      afterFailure.rows[0]?.version,
      "1",
      "failure response left a partial balance version",
    );
    assertEqual(
      afterFailure.rows[0]?.reservation_count,
      0,
      "failure response left a partial reservation",
    );
    assertEqual(
      afterFailure.rows[0]?.ledger_count,
      1,
      "failure response left a partial ledger entry",
    );

    await observer.query(
      "UPDATE inventory_locations SET status = 'PAUSED' WHERE id = $1",
      [expiring.inventoryLocationId],
    );
    const expiration = await main.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) =>
        inventory.applyReservationTransition(
          inventoryExpirationCommand(expiring),
        ),
    );
    const expirationValue = assertSuccess(
      expiration,
      "APPLY_INVENTORY_RESERVATION_TRANSITION",
    );
    assertEqual(
      expirationValue.balance.reserved,
      0,
      "expired reservation did not release inventory",
    );
    assertEqual(
      expirationValue.reservation.status,
      "EXPIRED",
      "reservation did not reach EXPIRED",
    );
  } finally {
    await main.close();
  }

  const applicationNameA = "p1-05-inventory-concurrent-a";
  const applicationNameB = "p1-05-inventory-concurrent-b";
  const persistenceA = createPostgresPersistence({
    ...clientConfig,
    application_name: applicationNameA,
  });
  const persistenceB = createPostgresPersistence({
    ...clientConfig,
    application_name: applicationNameB,
  });
  const applied = deferred();
  const release = deferred();
  const creationCommand = inventoryCreationCommand(fresh);
  try {
    const first = persistenceA.transactionManager.runInTransaction(
      transactionOptions,
      async ({ inventory }) => {
        const response =
          await inventory.applyReservationCreation(creationCommand);
        applied.resolve();
        await release.promise;
        return response;
      },
    );
    await applied.promise;
    const second = trackPromise(
      persistenceB.transactionManager.runInTransaction(
        transactionOptions,
        async ({ inventory }) =>
          inventory.applyReservationCreation(creationCommand),
      ),
    );
    try {
      await observeLockWait(
        observer,
        applicationNameB,
        second.state,
        "concurrent inventory reservation",
      );
    } finally {
      release.resolve();
    }
    const [firstResponse, secondOutcome] = await Promise.all([
      first,
      second.outcome,
    ]);
    assertSuccess(firstResponse, "APPLY_INVENTORY_RESERVATION_CREATION");
    if (!secondOutcome.ok) {
      throw secondOutcome.error;
    }
    assertEqual(
      secondOutcome.value.outcome,
      "FAILURE",
      "stale concurrent reservation unexpectedly succeeded",
    );
    assertEqual(
      secondOutcome.value.error.code,
      "VERSION_CONFLICT",
      "stale concurrent reservation returned the wrong stable failure",
    );

    const stored = await observer.query(
      `SELECT balance.reserved, balance.version,
              (SELECT count(*)::integer FROM inventory_ledger ledger
                WHERE ledger.inventory_item_id = balance.inventory_item_id
                  AND ledger.location_id = balance.location_id) AS ledger_count
         FROM inventory_balances balance
        WHERE balance.inventory_item_id = $1 AND balance.location_id = $2`,
      [fresh.inventoryItemId, fresh.inventoryLocationId],
    );
    assertEqual(stored.rows[0]?.reserved, "2", "inventory was over-reserved");
    assertEqual(stored.rows[0]?.version, "2", "balance CAS advanced twice");
    assertEqual(
      stored.rows[0]?.ledger_count,
      2,
      "concurrent reservation created a duplicate ledger entry",
    );
  } finally {
    release.resolve();
    await Promise.all([persistenceA.close(), persistenceB.close()]);
  }
}

async function runRepositoryHarness(clientConfig) {
  const migrationResult = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0009" },
  });
  assertEqual(
    migrationResult.currentVersion,
    "0009",
    "repository harness did not migrate to 0009",
  );

  const observer = new Client({
    ...clientConfig,
    application_name: "p1-05-repository-observer",
  });
  await observer.connect();
  try {
    await assertIdempotencyRepositories(clientConfig, observer);
    await assertOutboxRepository(clientConfig, observer);
    await assertInventoryRepository(clientConfig, observer);
  } finally {
    await observer.end();
  }
}

try {
  await withEphemeralPostgres(async (clientConfig) => {
    try {
      await runRepositoryHarness(clientConfig);
    } catch (error) {
      if (
        error instanceof RepositoryHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError ||
        error instanceof PersistenceTransactionFailureError
      ) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        "PostgreSQL repository integration failed",
      );
    }
  });
  console.log(
    "PostgreSQL repository integration passed (transactions, idempotency, outbox, inventory).",
  );
} catch (error) {
  const known =
    error instanceof RepositoryHarnessError ||
    error instanceof EphemeralPostgresError ||
    error instanceof MigrationExecutionError ||
    error instanceof MigrationManifestError;
  console.error(
    known ? error.message : "PostgreSQL repository integration failed",
  );
  process.exitCode = 1;
}
