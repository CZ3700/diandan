#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client, Pool } from "pg";

import {
  createDispatchOutboxEvent,
  createListReadyOutboxJobs,
  createProcessWebhookInbox,
  createReceivePaymentWebhook,
} from "../../application/dist/index.js";
import { createFakePaymentWebhookVerifier } from "../../payment-fake/dist/index.js";
import { parsePersistenceTransactionFailure } from "../../persistence-port/dist/index.js";
import {
  createPgBossReliableEventQueue,
  createPostgresPersistence,
  EphemeralPostgresError,
  RELIABLE_EVENT_QUEUE_NAMES,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const queueSchema = "p106_reliable_events";
const consumerKey = "p106-reliable-event-gate";
const waitTimeoutMs = 180_000;
const fixtureOccurredAt = new Date(Date.now() - 60_000).toISOString();

const fixture = Object.freeze({
  merchantId: "71000000-0000-4000-8000-000000000001",
  providerAccountId: "71000000-0000-4000-8000-000000000002",
  endpointAuditId: "71000000-0000-4000-8000-000000000003",
  endpointId: "71000000-0000-4000-8000-000000000004",
  outboxEventId: "71000000-0000-4000-8000-000000000005",
  outboxPrimarySubjectId: "71000000-0000-4000-8000-000000000007",
  outboxSecondarySubjectId: "71000000-0000-4000-8000-000000000008",
  requestId: "71000000-0000-4000-8000-000000000009",
  correlationId: "71000000-0000-4000-8000-000000000010",
  webhookOutboxGiftVariantId: "71000000-0000-4000-8000-000000000011",
  webhookOutboxPriceId: "71000000-0000-4000-8000-000000000012",
  verificationKeyReferenceHash: "7".repeat(64),
});
const webhookOutboxFixtures = Object.freeze({
  semanticReplay: Object.freeze({
    providerEventId: "semantic-replay-event",
    cartId: "72000000-0000-4000-8000-000000000001",
    cartItemId: "72000000-0000-4000-8000-000000000002",
    outboxEventId: "72000000-0000-4000-8000-000000000003",
    idempotencyKey: "p106-webhook-semantic-replay-v1",
  }),
  concurrent: Object.freeze({
    providerEventId: "ten-way-concurrent-event",
    cartId: "72000000-0000-4000-8000-000000000011",
    cartItemId: "72000000-0000-4000-8000-000000000012",
    outboxEventId: "72000000-0000-4000-8000-000000000013",
    idempotencyKey: "p106-webhook-concurrent-v1",
  }),
  deadLetter: Object.freeze({
    providerEventId: "finite-retry-dead-letter-event",
    cartId: "72000000-0000-4000-8000-000000000021",
    cartItemId: "72000000-0000-4000-8000-000000000022",
    outboxEventId: "72000000-0000-4000-8000-000000000023",
    idempotencyKey: "p106-webhook-dead-letter-v1",
  }),
});
const verificationSecret = Buffer.from(
  "p106-test-only-webhook-secret-32b",
  "utf8",
);

class ReliableEventHarnessError extends Error {}

function fail(message) {
  throw new ReliableEventHarnessError(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message} (${String(actual)} != ${String(expected)})`);
  }
}

function connectionString(clientConfig) {
  return `postgresql://${encodeURIComponent(clientConfig.user)}:${encodeURIComponent(clientConfig.password)}@${clientConfig.host}:${clientConfig.port}/${encodeURIComponent(clientConfig.database)}`;
}

function timestampNow() {
  return new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString();
}

function signedHeaders(rawBody, receivedAt, bodyToSign = rawBody) {
  const timestamp = String(Math.floor(Date.parse(receivedAt) / 1_000));
  const signature = createHmac("sha256", verificationSecret)
    .update(timestamp, "utf8")
    .update(".", "utf8")
    .update(bodyToSign)
    .digest("hex");
  return {
    "x-fan-support-signature": `v1=${signature}`,
    "x-fan-support-timestamp": timestamp,
  };
}

function paymentBody({ eventId, status = "processing", spacing = 0 }) {
  const value = {
    event_id: eventId,
    created_at: fixtureOccurredAt,
    resource: {
      kind: "payment",
      payment_reference: `payment-${eventId}`,
      state: status,
      amount_minor: 2500,
      currency: "usd",
    },
  };
  return Buffer.from(JSON.stringify(value, null, spacing), "utf8");
}

function webhookOutboxFixtureFor(providerEventId) {
  return Object.values(webhookOutboxFixtures).find(
    (candidate) => candidate.providerEventId === providerEventId,
  );
}

function webhookOutboxCommand(context, outboxFixture) {
  return {
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: outboxFixture.outboxEventId,
      occurredAt: context.event.occurredAt,
      correlationId: fixture.correlationId,
      requestId: fixture.requestId,
      eventType: "CART_ITEM_ADDED",
      aggregateId: outboxFixture.cartId,
      payload: {
        cartId: outboxFixture.cartId,
        cartItemId: outboxFixture.cartItemId,
      },
    },
    aggregateVersion: 1,
    primarySubjectId: outboxFixture.cartId,
    secondarySubjectId: outboxFixture.cartItemId,
    market: "US",
    currency: "USD",
    idempotencyKey: outboxFixture.idempotencyKey,
    availableAt: context.event.occurredAt,
  };
}

function commandFor(
  rawBody,
  receivedAt,
  headers = signedHeaders(rawBody, receivedAt),
) {
  return {
    schemaVersion: 1,
    operation: "RECEIVE_PAYMENT_WEBHOOK",
    endpointId: fixture.endpointId,
    rawBodyBase64: rawBody.toString("base64url"),
    headers,
    receivedAt,
    correlationId: fixture.correlationId,
    propagation: {
      schemaVersion: 1,
      requestId: fixture.requestId,
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
    },
  };
}

async function queryScalar(client, text, values = []) {
  const result = await client.query(text, values);
  if (result.rows.length !== 1) {
    fail("database scalar query returned an unexpected shape");
  }
  return result.rows[0];
}

async function tableCounts(client) {
  return queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer FROM webhook_payloads) AS payloads,
       (SELECT count(*)::integer FROM webhook_inbox) AS inbox,
       (SELECT count(*)::integer FROM provider_events) AS events,
       (SELECT count(*)::integer FROM provider_event_associations) AS associations,
       (SELECT count(*)::integer FROM ${queueSchema}.job) AS queue_jobs`,
  );
}

async function webhookEventCounts(client, providerEventId) {
  return queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer
          FROM webhook_payloads payload
          JOIN webhook_inbox inbox ON inbox.webhook_payload_id = payload.id
         WHERE inbox.provider_event_id = $1) AS payloads,
       (SELECT count(*)::integer
          FROM webhook_inbox
         WHERE provider_event_id = $1) AS inbox,
       (SELECT count(*)::integer
          FROM provider_events
         WHERE provider_event_id = $1) AS events,
       (SELECT count(*)::integer
          FROM provider_event_associations association
          JOIN provider_events event ON event.id = association.provider_event_id
         WHERE event.provider_event_id = $1) AS associations,
       (SELECT count(*)::integer
          FROM ${queueSchema}.job job
          JOIN webhook_inbox inbox ON inbox.id = job.id
         WHERE inbox.provider_event_id = $1
           AND job.name = $2
           AND job.data->>'webhookInboxId' = inbox.id::text) AS queue_jobs`,
    [providerEventId, RELIABLE_EVENT_QUEUE_NAMES.webhookInbox],
  );
}

async function webhookOutboxCounts(client, outboxFixture) {
  return queryScalar(
    client,
    `SELECT
       count(*)::integer AS candidates,
       count(*) FILTER (
         WHERE id = $1
           AND event_type = 'CART_ITEM_ADDED'
           AND aggregate_type = 'CART'
           AND aggregate_id = $2
           AND aggregate_version = 1
           AND primary_subject_id = $2
           AND secondary_subject_id = $3
           AND idempotency_key = $4
           AND locale = 'en'
           AND market = 'US'
           AND currency = 'USD'
           AND request_id = $5
           AND correlation_id = $6
           AND causation_id IS NULL
           AND trace_id IS NULL
           AND occurred_at = $7
           AND available_at = $7
           AND payload_status IS NULL
           AND schema_version = 1
       )::integer AS exact
       FROM outbox_events
      WHERE id = $1
         OR idempotency_key = $4
         OR (event_type = 'CART_ITEM_ADDED'
             AND aggregate_type = 'CART'
             AND aggregate_id = $2
             AND aggregate_version = 1)`,
    [
      outboxFixture.outboxEventId,
      outboxFixture.cartId,
      outboxFixture.cartItemId,
      outboxFixture.idempotencyKey,
      fixture.requestId,
      fixture.correlationId,
      fixtureOccurredAt,
    ],
  );
}

const safeReceiptSuccessCodes = new Set(["ACCEPTED_NEW", "ACCEPTED_REPLAY"]);
const safeReceiptFailureCodes = new Set([
  "INVALID_REQUEST",
  "ENDPOINT_UNAVAILABLE",
  "INVALID_SIGNATURE",
  "EVENT_OUTSIDE_TOLERANCE",
  "UNSUPPORTED_EVENT",
  "IDEMPOTENCY_CONFLICT",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
]);
const safeReceiptRecoveries = new Set(["NONE", "RETRY_SAME_COMMAND"]);

function safeReceiptOutcome(result) {
  if (
    typeof result === "object" &&
    result !== null &&
    result.outcome === "SUCCESS" &&
    typeof result.value === "object" &&
    result.value !== null &&
    safeReceiptSuccessCodes.has(result.value.decision)
  ) {
    return {
      outcome: "SUCCESS",
      code: result.value.decision,
      recovery: "NONE",
    };
  }
  if (
    typeof result === "object" &&
    result !== null &&
    result.outcome === "FAILURE" &&
    typeof result.error === "object" &&
    result.error !== null &&
    safeReceiptFailureCodes.has(result.error.code) &&
    safeReceiptRecoveries.has(result.error.recovery)
  ) {
    return {
      outcome: "FAILURE",
      code: result.error.code,
      recovery: result.error.recovery,
    };
  }
  return {
    outcome: "FAILURE",
    code: "MALFORMED_RESULT",
    recovery: "NONE",
  };
}

function concurrentReceiptDistribution(results) {
  const counts = new Map();
  for (const result of results) {
    const outcome = safeReceiptOutcome(result);
    const key = `${outcome.outcome}\u0000${outcome.code}\u0000${outcome.recovery}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [outcome, code, recovery] = key.split("\u0000");
      return { outcome, code, recovery, count };
    });
}

function concurrentReceiptDiagnostic(results) {
  return JSON.stringify(concurrentReceiptDistribution(results));
}

function assertConcurrentReceipt(condition, results) {
  if (!condition) {
    fail(concurrentReceiptDiagnostic(results));
  }
}

function assertConcurrentReceiptDiagnosticIsSafe(results) {
  const distribution = concurrentReceiptDistribution(results);
  const safe = distribution.every(
    (entry) =>
      JSON.stringify(Object.keys(entry)) ===
        JSON.stringify(["outcome", "code", "recovery", "count"]) &&
      [entry.outcome, entry.code, entry.recovery].every(
        (value) =>
          typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value),
      ) &&
      Number.isInteger(entry.count) &&
      entry.count > 0,
  );
  assert(safe, "concurrent receipt diagnostic was not strictly redacted");
}

function createControlledSerializablePersistence({
  clientConfig,
  publishWebhookInbox,
}) {
  let releaseSnapshot;
  const snapshotRelease = new Promise((resolve) => {
    releaseSnapshot = resolve;
  });
  const state = {
    snapshotObserved: false,
    inboxInsertBlocked: false,
    snapshotReleased: false,
    collisionConstraint: "NOT_OBSERVED",
    failureStatement: "NOT_OBSERVED",
  };
  const persistence = createPostgresPersistenceWithPoolFactory(
    clientConfig,
    { publishWebhookInbox },
    (normalizedConfig) => {
      const pool = new Pool(normalizedConfig);
      return {
        connect: async () => {
          const client = await pool.connect();
          return {
            query: async (text, values = []) => {
              const statement = typeof text === "string" ? text : "";
              const isInboxInsert = statement.includes(
                "reliable-event:insert-webhook-inbox",
              );
              const isPayloadInsert = statement.includes(
                "reliable-event:insert-webhook-payload",
              );
              const isProviderEventLoad = statement.includes(
                "reliable-event:load-provider-event",
              );
              // Keep the SERIALIZABLE snapshot stale, but let the unrelated
              // payload write finish so SSI cannot preempt the target unique
              // constraint before this controlled inbox collision.
              if (
                state.snapshotObserved &&
                !state.inboxInsertBlocked &&
                isInboxInsert
              ) {
                state.inboxInsertBlocked = true;
                await snapshotRelease;
              }
              let result;
              try {
                result = await client.query(text, values);
              } catch (error) {
                if (isInboxInsert) {
                  state.failureStatement = "INSERT_WEBHOOK_INBOX";
                } else if (isPayloadInsert) {
                  state.failureStatement = "INSERT_WEBHOOK_PAYLOAD";
                } else {
                  state.failureStatement = "OTHER";
                }
                if (isInboxInsert) {
                  state.collisionConstraint =
                    typeof error === "object" &&
                    error !== null &&
                    "constraint" in error &&
                    error.constraint === "webhook_inbox_provider_event_unique"
                      ? "webhook_inbox_provider_event_unique"
                      : "UNRECOGNIZED_CONSTRAINT";
                }
                throw error;
              }
              if (
                !state.snapshotObserved &&
                isProviderEventLoad &&
                Array.isArray(result.rows) &&
                result.rows.length === 0
              ) {
                state.snapshotObserved = true;
              }
              return result;
            },
            release: (destroy = false) => client.release(destroy),
          };
        },
        end: () => pool.end(),
        on: (_event, listener) => {
          pool.on("error", listener);
        },
        off: (_event, listener) => {
          pool.off("error", listener);
        },
      };
    },
  );
  return {
    persistence,
    state,
    releaseSnapshot: () => {
      if (!state.snapshotReleased) {
        state.snapshotReleased = true;
        releaseSnapshot();
      }
    },
  };
}

function capturePersistenceFailures(persistence, failures) {
  return {
    reliableEventTransactionManager: {
      runInReliableEventTransaction: async (options, work) => {
        try {
          return await persistence.reliableEventTransactionManager.runInReliableEventTransaction(
            options,
            work,
          );
        } catch (error) {
          const parsed = parsePersistenceTransactionFailure(error);
          failures.push(
            parsed === undefined
              ? { code: "UNPARSEABLE_FAILURE", recovery: "NONE" }
              : {
                  code: parsed.error.code,
                  recovery: parsed.error.recovery,
                },
          );
          throw error;
        }
      },
    },
  };
}

async function waitUntil(label, predicate, timeoutMs = waitTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(250);
  }
  fail(`${label} did not reach the expected state before timeout`);
}

async function seedConfiguration(client, receivedAt) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO merchant_entities (id, entity_key, legal_country, status)
       VALUES ($1, 'p106-reliable-events', 'US', 'ACTIVE')`,
      [fixture.merchantId],
    );
    await client.query(
      `INSERT INTO payment_provider_accounts (
         id, merchant_entity_id, adapter_key, environment,
         account_reference_digest, credential_secret_ref, status
       ) VALUES ($1, $2, 'fake_psp', 'TEST', decode(repeat('71', 32), 'hex'),
                 'secret-ref:v1:test:p106/provider', 'ACTIVE')`,
      [fixture.providerAccountId, fixture.merchantId],
    );
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         reason_code, request_id, correlation_id, outcome
       ) VALUES ($1, 'SYSTEM', 'p106-reliable-events',
                 'PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED', 'PAYMENT_WEBHOOK_ENDPOINT',
                 $2, 'INITIAL_ENDPOINT', $3, $4, 'SUCCEEDED')`,
      [
        fixture.endpointAuditId,
        fixture.endpointId,
        fixture.requestId,
        fixture.correlationId,
      ],
    );
    await client.query(
      `INSERT INTO payment_webhook_endpoints (
         id, provider_account_id, environment, verification_secret_ref,
         verification_key_reference_hash, status, active_from,
         lifecycle_audit_log_id
       ) VALUES ($1, $2, 'TEST', 'secret-ref:v1:test:p106/webhook', $3,
                 'ACTIVE', $4::timestamptz - interval '1 hour', $5)`,
      [
        fixture.endpointId,
        fixture.providerAccountId,
        fixture.verificationKeyReferenceHash,
        receivedAt,
        fixture.endpointAuditId,
      ],
    );
    for (const [index, outboxFixture] of Object.values(
      webhookOutboxFixtures,
    ).entries()) {
      await client.query(
        `INSERT INTO carts (
           id, token_digest, token_pepper_version, presentation_locale,
           market, currency, status, version, expires_at
         ) VALUES ($1, $2, 'p106-webhook-outbox-v1', 'en', 'US', 'USD',
                   'ACTIVE', 1, $3::timestamptz + interval '1 day')`,
        [outboxFixture.cartId, Buffer.alloc(32, 0x72 + index), receivedAt],
      );
      await client.query(
        `INSERT INTO cart_items (
           id, cart_id, gift_variant_id, observed_price_id, quantity,
           display_mode, has_fan_message, request_id, correlation_id,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 1, 'anonymous', false, $5, $6,
                   $7::timestamptz, $7::timestamptz)`,
        [
          outboxFixture.cartItemId,
          outboxFixture.cartId,
          fixture.webhookOutboxGiftVariantId,
          fixture.webhookOutboxPriceId,
          fixture.requestId,
          fixture.correlationId,
          fixtureOccurredAt,
        ],
      );
    }
    await client.query(
      `INSERT INTO outbox_events (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         primary_subject_id, secondary_subject_id, idempotency_key,
         correlation_id, request_id, occurred_at, available_at, payload_status
       ) VALUES ($1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 1,
                 $3, $4, 'p106-outbox-event-0001', $5, $6,
                 $7::timestamptz - interval '1 second', $7::timestamptz,
                 'PROCESSING')`,
      [
        fixture.outboxEventId,
        fixture.outboxPrimarySubjectId,
        fixture.outboxPrimarySubjectId,
        fixture.outboxSecondarySubjectId,
        fixture.correlationId,
        fixture.requestId,
        receivedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function createReceiveHarness(persistence, encryptedInputs) {
  const verifier = createFakePaymentWebhookVerifier({
    endpointId: fixture.endpointId,
    providerAccountId: fixture.providerAccountId,
    environment: "TEST",
    verificationKeyReferenceHash: fixture.verificationKeyReferenceHash,
    verificationSecret,
  });
  return createReceivePaymentWebhook({
    transactionManager: persistence.reliableEventTransactionManager,
    verifierForEndpoint: (adapterKey, endpointId) =>
      adapterKey === "fake_psp" && endpointId === fixture.endpointId
        ? verifier
        : undefined,
    keyManagement: {
      encryptEnvelope: async (command) => {
        encryptedInputs.push(command.plaintextBase64);
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: {
            ciphertext: `enc:v1:${Buffer.alloc(32, 0x71).toString("base64url")}`,
            encryptedDataKey: `enc:v1:${Buffer.alloc(32, 0x72).toString("base64url")}`,
            keyVersion: "p106-webhook-test-key-v1",
            algorithm: "AES_256_GCM",
          },
        };
      },
    },
    createId: randomUUID,
    sha256Hex: async (rawBodyBase64) =>
      createHash("sha256")
        .update(Buffer.from(rawBodyBase64, "base64url"))
        .digest("hex"),
  });
}

async function assertOutsideToleranceScenarios({
  client,
  encryptedInputs,
  receive,
  receivedAt,
}) {
  const baseline = await tableCounts(client);
  const encryptedBefore = encryptedInputs.length;
  const receivedAtMs = Date.parse(receivedAt);
  const scenarios = [
    {
      eventId: "expired-signature-event",
      signatureAt: new Date(
        receivedAtMs - 10 * 60 * 1_000 - 1_000,
      ).toISOString(),
    },
    {
      eventId: "future-signature-event",
      signatureAt: new Date(
        receivedAtMs + 5 * 60 * 1_000 + 1_000,
      ).toISOString(),
    },
  ];
  for (const scenario of scenarios) {
    const body = paymentBody({ eventId: scenario.eventId });
    const result = await receive(
      commandFor(body, receivedAt, signedHeaders(body, scenario.signatureAt)),
    );
    assertEqual(
      result.outcome,
      "FAILURE",
      "an outside-tolerance signature was accepted",
    );
    assertEqual(
      result.error.code,
      "EVENT_OUTSIDE_TOLERANCE",
      "an outside-tolerance signature returned the wrong stable error",
    );
    assertEqual(
      result.error.recovery,
      "NONE",
      "an outside-tolerance signature was made retryable",
    );
    assertEqual(
      encryptedInputs.length,
      encryptedBefore,
      "an outside-tolerance signature reached envelope encryption",
    );
    assertEqual(
      JSON.stringify(await tableCounts(client)),
      JSON.stringify(baseline),
      "an outside-tolerance signature changed durable cardinality",
    );
  }
  return scenarios.length;
}

async function assertIngressAndReceiptScenarios({
  client,
  persistence,
  receivedAt,
}) {
  const encryptedInputs = [];
  const receive = createReceiveHarness(persistence, encryptedInputs);
  const baseline = await tableCounts(client);
  const invalidBody = paymentBody({ eventId: "invalid-signature" });
  const invalidResult = await receive(
    commandFor(invalidBody, receivedAt, {
      ...signedHeaders(invalidBody, receivedAt),
      "x-fan-support-signature": `v1=${"0".repeat(64)}`,
    }),
  );
  assertEqual(
    invalidResult.outcome,
    "FAILURE",
    "invalid signature was accepted",
  );
  assertEqual(
    invalidResult.error.code,
    "INVALID_SIGNATURE",
    "invalid signature returned the wrong stable error",
  );

  const untampered = paymentBody({ eventId: "tampered-signature" });
  const tampered = Buffer.concat([untampered, Buffer.from(" ", "utf8")]);
  const tamperedResult = await receive(
    commandFor(
      tampered,
      receivedAt,
      signedHeaders(tampered, receivedAt, untampered),
    ),
  );
  assertEqual(
    tamperedResult.outcome,
    "FAILURE",
    "tampered payload was accepted",
  );
  assertEqual(
    tamperedResult.error.code,
    "INVALID_SIGNATURE",
    "tampered payload returned the wrong stable error",
  );
  assertEqual(
    JSON.stringify(await tableCounts(client)),
    JSON.stringify(baseline),
    "an unauthenticated webhook reached durable storage",
  );
  assertEqual(
    encryptedInputs.length,
    0,
    "an unauthenticated webhook reached envelope encryption",
  );
  const outsideToleranceScenarios = await assertOutsideToleranceScenarios({
    client,
    encryptedInputs,
    receive,
    receivedAt,
  });

  const semanticEventId = webhookOutboxFixtures.semanticReplay.providerEventId;
  const exactRawBody = paymentBody({ eventId: semanticEventId });
  const exactResult = await receive(commandFor(exactRawBody, receivedAt));
  assertEqual(exactResult.outcome, "SUCCESS", "valid webhook receipt failed");
  assertEqual(
    exactResult.value.decision,
    "ACCEPTED_NEW",
    "first receipt was not new",
  );
  assert(
    Buffer.from(encryptedInputs[0], "base64url").equals(exactRawBody),
    "raw bytes changed before encryption",
  );
  const storedDigest = await queryScalar(
    client,
    `SELECT payload_sha256 FROM webhook_payloads
      WHERE id = (SELECT webhook_payload_id FROM webhook_inbox
                   WHERE provider_event_id = $1)`,
    [semanticEventId],
  );
  assertEqual(
    storedDigest.payload_sha256,
    createHash("sha256").update(exactRawBody).digest("hex"),
    "stored payload digest does not cover the exact received bytes",
  );

  const semanticReplayBody = paymentBody({
    eventId: semanticEventId,
    spacing: 2,
  });
  const semanticReplay = await receive(
    commandFor(semanticReplayBody, receivedAt),
  );
  assertEqual(semanticReplay.outcome, "SUCCESS", "semantic replay failed");
  assertEqual(
    semanticReplay.value.decision,
    "ACCEPTED_REPLAY",
    "equivalent provider semantics did not replay",
  );
  const semanticConflictBody = paymentBody({
    eventId: semanticEventId,
    status: "failed",
  });
  const semanticConflict = await receive(
    commandFor(semanticConflictBody, receivedAt),
  );
  assertEqual(
    semanticConflict.outcome,
    "FAILURE",
    "changed provider semantics were accepted",
  );
  assertEqual(
    semanticConflict.error.code,
    "IDEMPOTENCY_CONFLICT",
    "changed provider semantics returned the wrong stable error",
  );
  const semanticCounts = await queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer FROM webhook_payloads payload
         JOIN webhook_inbox inbox ON inbox.webhook_payload_id = payload.id
        WHERE inbox.provider_event_id = $1) AS payloads,
       (SELECT count(*)::integer FROM webhook_inbox
        WHERE provider_event_id = $1) AS inbox,
       (SELECT count(*)::integer FROM provider_events
        WHERE provider_event_id = $1) AS events,
       (SELECT count(*)::integer FROM ${queueSchema}.job job
         JOIN webhook_inbox inbox ON inbox.id = job.id
        WHERE inbox.provider_event_id = $1
          AND job.name = $2
          AND job.data->>'webhookInboxId' = inbox.id::text) AS jobs`,
    [semanticEventId, RELIABLE_EVENT_QUEUE_NAMES.webhookInbox],
  );
  for (const value of Object.values(semanticCounts)) {
    assertEqual(
      value,
      1,
      "semantic replay or conflict changed durable cardinality",
    );
  }

  const concurrentEventId = webhookOutboxFixtures.concurrent.providerEventId;
  const concurrentBody = paymentBody({ eventId: concurrentEventId });
  const concurrentResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      receive(commandFor(concurrentBody, receivedAt)),
    ),
  );
  const concurrentOutcomes = concurrentResults.map(safeReceiptOutcome);
  assertConcurrentReceiptDiagnosticIsSafe(concurrentResults);
  assertConcurrentReceipt(
    concurrentOutcomes.filter(
      (outcome) =>
        outcome.outcome === "SUCCESS" && outcome.code === "ACCEPTED_NEW",
    ).length === 1,
    concurrentResults,
  );
  assertConcurrentReceipt(
    concurrentOutcomes.every(
      (outcome) =>
        outcome.outcome === "SUCCESS" ||
        (outcome.code === "TEMPORARY_UNAVAILABLE" &&
          outcome.recovery === "RETRY_SAME_COMMAND"),
    ),
    concurrentResults,
  );
  const convergedResults = [];
  for (const result of concurrentResults) {
    const outcome = safeReceiptOutcome(result);
    convergedResults.push(
      outcome.outcome === "SUCCESS"
        ? result
        : await receive(commandFor(concurrentBody, receivedAt)),
    );
  }
  const convergedOutcomes = convergedResults.map(safeReceiptOutcome);
  assertConcurrentReceiptDiagnosticIsSafe(convergedResults);
  assertConcurrentReceipt(
    convergedOutcomes.every(
      (outcome) =>
        outcome.outcome === "SUCCESS" &&
        safeReceiptSuccessCodes.has(outcome.code),
    ),
    convergedResults,
  );
  const concurrentCounts = await queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer FROM webhook_inbox WHERE provider_event_id = $1) AS inbox,
       (SELECT count(*)::integer FROM provider_events WHERE provider_event_id = $1) AS events,
       (SELECT count(*)::integer
          FROM ${queueSchema}.job job
          JOIN webhook_inbox inbox ON inbox.id = job.id
         WHERE inbox.provider_event_id = $1
           AND job.name = $2
           AND job.data->>'webhookInboxId' = inbox.id::text) AS jobs`,
    [concurrentEventId, RELIABLE_EVENT_QUEUE_NAMES.webhookInbox],
  );
  assertConcurrentReceipt(
    concurrentCounts.inbox === 1 &&
      concurrentCounts.events === 1 &&
      concurrentCounts.jobs === 1,
    convergedResults,
  );

  const dlqEventId = webhookOutboxFixtures.deadLetter.providerEventId;
  const dlqBody = paymentBody({ eventId: dlqEventId });
  const dlqResult = await receive(commandFor(dlqBody, receivedAt));
  assertEqual(dlqResult.outcome, "SUCCESS", "DLQ fixture receipt failed");
  assertEqual(
    dlqResult.value.decision,
    "ACCEPTED_NEW",
    "DLQ fixture was not new",
  );

  return {
    concurrentEventId,
    concurrentReceiptDiagnosticsSafe: true,
    dlqEventId,
    outsideToleranceScenarios,
    semanticEventId,
  };
}

async function assertControlledSerializableReceiptRace({
  client,
  clientConfig,
  persistence,
  queue,
  receivedAt,
}) {
  const controlled = createControlledSerializablePersistence({
    clientConfig,
    publishWebhookInbox: (transaction, job) =>
      queue.publishWebhookInbox(transaction, job),
  });
  const capturedFailures = [];
  const loserReceive = createReceiveHarness(
    capturePersistenceFailures(controlled.persistence, capturedFailures),
    [],
  );
  const winnerReceive = createReceiveHarness(persistence, []);
  const providerEventId = "controlled-stale-snapshot-event";
  const body = paymentBody({ eventId: providerEventId });
  const command = commandFor(body, receivedAt);
  let loserPromise;
  try {
    const before = await webhookEventCounts(client, providerEventId);
    assert(
      Object.values(before).every((value) => value === 0),
      "controlled receipt fixture was not isolated",
    );

    let loserSettled = false;
    loserPromise = loserReceive(command).finally(() => {
      loserSettled = true;
    });
    await waitUntil(
      "controlled SERIALIZABLE stale snapshot",
      () => {
        if (loserSettled && !controlled.state.inboxInsertBlocked) {
          fail("controlled receipt did not reach its blocked inbox insert");
        }
        return (
          controlled.state.snapshotObserved &&
          controlled.state.inboxInsertBlocked
        );
      },
      30_000,
    );

    let winnerResult;
    let orchestrationFailure;
    try {
      winnerResult = await winnerReceive(command);
    } catch (error) {
      orchestrationFailure = error;
    } finally {
      controlled.releaseSnapshot();
    }
    const loserResult = await loserPromise;
    if (orchestrationFailure !== undefined) {
      throw orchestrationFailure;
    }

    assertEqual(
      winnerResult.outcome,
      "SUCCESS",
      "controlled race winner did not succeed",
    );
    assertEqual(
      winnerResult.value.decision,
      "ACCEPTED_NEW",
      "controlled race winner was not new",
    );
    assertEqual(
      controlled.state.collisionConstraint,
      "webhook_inbox_provider_event_unique",
      "controlled race did not reach the provider-event uniqueness boundary",
    );
    assertEqual(
      controlled.state.failureStatement,
      "INSERT_WEBHOOK_INBOX",
      "controlled race failed outside the inbox uniqueness write",
    );
    assertEqual(
      JSON.stringify(capturedFailures),
      JSON.stringify([
        {
          code: "TRANSACTION_ABORTED",
          recovery: "RETRY_SAME_COMMAND",
        },
      ]),
      "controlled race did not use the repository retry mapping",
    );
    assertEqual(
      loserResult.outcome,
      "FAILURE",
      "controlled race loser unexpectedly succeeded",
    );
    assertEqual(
      loserResult.error.code,
      "TEMPORARY_UNAVAILABLE",
      "controlled race loser returned the wrong public error",
    );
    assertEqual(
      loserResult.error.recovery,
      "RETRY_SAME_COMMAND",
      "controlled race loser was not safely retryable",
    );

    const retryResult = await loserReceive(command);
    assertEqual(
      retryResult.outcome,
      "SUCCESS",
      "controlled race retry did not succeed",
    );
    assertEqual(
      retryResult.value.decision,
      "ACCEPTED_REPLAY",
      "controlled race retry did not converge to replay",
    );
    assertEqual(
      retryResult.value.webhookInboxId,
      winnerResult.value.webhookInboxId,
      "controlled race retry returned a different inbox identity",
    );
    assertEqual(
      retryResult.value.providerEventRowId,
      winnerResult.value.providerEventRowId,
      "controlled race retry returned a different event identity",
    );
    const after = await webhookEventCounts(client, providerEventId);
    assert(
      Object.values(after).every((value) => value === 1),
      "controlled race did not converge to one durable row and job",
    );
    return 1;
  } finally {
    controlled.releaseSnapshot();
    if (loserPromise !== undefined) {
      await loserPromise.catch(() => undefined);
    }
    await controlled.persistence.close().catch(() => undefined);
  }
}

async function assertPublishRollback({
  client,
  clientConfig,
  queue,
  receivedAt,
}) {
  const jobsBefore = await queryScalar(
    client,
    `SELECT count(*)::integer AS count FROM ${queueSchema}.job`,
  );
  const failingPersistence = createPostgresPersistence(clientConfig, {
    publishWebhookInbox: async (transaction, job) => {
      await queue.publishWebhookInbox(transaction, job);
      throw new Error("test-only publisher failure");
    },
  });
  try {
    const receive = createReceiveHarness(failingPersistence, []);
    const eventId = "atomic-publish-rollback-event";
    const body = paymentBody({ eventId });
    const result = await receive(commandFor(body, receivedAt));
    assertEqual(result.outcome, "FAILURE", "publisher failure was accepted");
    assertEqual(
      result.error.code,
      "TEMPORARY_UNAVAILABLE",
      "publisher failure returned the wrong stable error",
    );
    const counts = await queryScalar(
      client,
      `SELECT
         (SELECT count(*)::integer FROM webhook_inbox WHERE provider_event_id = $1) AS inbox,
         (SELECT count(*)::integer FROM provider_events WHERE provider_event_id = $1) AS events`,
      [eventId],
    );
    assertEqual(counts.inbox, 0, "publisher failure committed an inbox row");
    assertEqual(
      counts.events,
      0,
      "publisher failure committed a provider event",
    );
    const jobsAfter = await queryScalar(
      client,
      `SELECT count(*)::integer AS count FROM ${queueSchema}.job`,
    );
    assertEqual(
      jobsAfter.count,
      jobsBefore.count,
      "publisher failure committed a queue job",
    );
  } finally {
    await failingPersistence.close();
  }
}

async function assertIdOnlyQueue(client) {
  const jobs = await client.query(
    `SELECT name, data FROM ${queueSchema}.job
      WHERE name IN ($1, $2)`,
    [
      RELIABLE_EVENT_QUEUE_NAMES.webhookInbox,
      RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch,
    ],
  );
  assert(jobs.rows.length > 0, "reliable event queue contains no jobs");
  for (const row of jobs.rows) {
    const keys = Object.keys(row.data).sort();
    const expectedKeys =
      row.name === RELIABLE_EVENT_QUEUE_NAMES.webhookInbox
        ? [
            "correlationId",
            "jobType",
            "propagation",
            "schemaVersion",
            "webhookInboxId",
          ]
        : [
            "consumerKey",
            "correlationId",
            "jobType",
            "outboxEventId",
            "propagation",
            "schemaVersion",
          ];
    assertEqual(
      JSON.stringify(keys),
      JSON.stringify(expectedKeys.sort()),
      "queue job contains fields outside the ID-only contract",
    );
    const serialized = JSON.stringify(row.data);
    assert(
      !/raw|signature|secret|ciphertext|encryptedDataKey/iu.test(serialized),
      "queue job contains payment evidence or secret material",
    );
  }
}

async function publishOutboxFixture(persistence, queue, receivedAt) {
  const listReady = createListReadyOutboxJobs({
    transactionManager: persistence.reliableEventTransactionManager,
  });
  const jobs = await listReady({
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey,
    availableAtOrBefore: receivedAt,
    limit: 10,
    propagation: {
      schemaVersion: 1,
      requestId: fixture.requestId,
      traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-01`,
    },
  });
  assertEqual(
    jobs.length,
    1,
    "outbox relay did not return exactly one fixture",
  );
  await queue.publishOutboxDispatch(jobs[0]);
}

function createWorkerHandlers(persistence, dlqEventId, state) {
  const processWebhook = createProcessWebhookInbox({
    transactionManager: persistence.reliableEventTransactionManager,
    handlerForEvent: () => ({
      effect: (context) => ({
        effectKey: "P106_WEBHOOK_EFFECT",
        subjectId: context.providerEventRowId,
      }),
      handle: async (context, repositories) => {
        const outboxFixture = webhookOutboxFixtureFor(
          context.event.providerEventId,
        );
        if (outboxFixture !== undefined) {
          const appended = await repositories.outbox.append(
            webhookOutboxCommand(context, outboxFixture),
          );
          if (
            appended.schemaVersion !== 1 ||
            appended.operation !== "APPEND_OUTBOX_EVENT" ||
            appended.outcome !== "SUCCESS" ||
            appended.value.appended !== true ||
            appended.value.eventId !== outboxFixture.outboxEventId
          ) {
            throw new Error("test-only webhook outbox append failed");
          }
        }
        if (context.event.providerEventId === dlqEventId) {
          state.outboxAppendsBeforeFailure += 1;
          throw new Error("test-only permanent handler failure");
        }
        state.webhookHandlerCalls.set(
          context.event.providerEventId,
          (state.webhookHandlerCalls.get(context.event.providerEventId) ?? 0) +
            1,
        );
      },
    }),
    createId: randomUUID,
    now: timestampNow,
  });
  const dispatchOutbox = createDispatchOutboxEvent({
    transactionManager: persistence.reliableEventTransactionManager,
    consumerForKey: (key) =>
      key === consumerKey
        ? {
            effect: (context) => ({
              effectKey: "P106_OUTBOX_EFFECT",
              subjectId: context.outboxEventId,
            }),
            dispatch: async (_context, delivery) => {
              assertEqual(
                delivery.idempotencyKey,
                `${fixture.outboxEventId}:${consumerKey}`,
                "outbox delivery idempotency key was unstable",
              );
              state.externalDispatches += 1;
            },
          }
        : undefined,
    createId: randomUUID,
    now: timestampNow,
  });
  return {
    processWebhookInbox: processWebhook,
    dispatchOutboxEvent: async (job, context) => {
      if (job.outboxEventId === fixture.outboxEventId) {
        state.outboxWrapperInvocations += 1;
      }
      try {
        await dispatchOutbox(job, context);
      } catch (error) {
        state.outboxErrorCodes.add(
          typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
            ? error.code
            : "UNCLASSIFIED",
        );
        throw error;
      }
      if (
        job.outboxEventId === fixture.outboxEventId &&
        !state.postCommitFailureInjected
      ) {
        state.postCommitFailureInjected = true;
        throw new Error("test-only post-commit pre-ack failure");
      }
    },
  };
}

async function assertWorkersAndDlq({
  client,
  persistence,
  connection,
  concurrentEventId,
  dlqEventId,
  semanticEventId,
}) {
  const state = {
    webhookHandlerCalls: new Map(),
    outboxAppendsBeforeFailure: 0,
    externalDispatches: 0,
    outboxWrapperInvocations: 0,
    postCommitFailureInjected: false,
    outboxErrorCodes: new Set(),
  };
  const handlers = createWorkerHandlers(persistence, dlqEventId, state);
  const workers = [1, 2].map(() =>
    createPgBossReliableEventQueue({
      schemaVersion: 1,
      connectionString: connection,
      schema: queueSchema,
      managementMode: "VERIFY",
      localConcurrency: 1,
    }),
  );
  let processingFailure;
  try {
    await Promise.all(workers.map((worker) => worker.start(handlers)));
    try {
      await waitUntil(
        "outbox commit-before-ACK replay",
        async () => {
          const row = await queryScalar(
            client,
            `SELECT
             (SELECT count(*)::integer FROM outbox_effect_receipts
               WHERE outbox_event_id = $1 AND consumer_key = $2) AS effects,
             (SELECT count(*)::integer FROM outbox_dispatch_attempts
               WHERE outbox_event_id = $1 AND consumer_key = $2
                 AND outcome = 'SUCCEEDED') AS successes,
             (SELECT state::text FROM ${queueSchema}.job
               WHERE name = $3 AND data->>'outboxEventId' = $1::text
               LIMIT 1) AS queue_state,
             (SELECT retry_count::integer FROM ${queueSchema}.job
               WHERE name = $3 AND data->>'outboxEventId' = $1::text
               LIMIT 1) AS retry_count`,
            [
              fixture.outboxEventId,
              consumerKey,
              RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch,
            ],
          );
          return (
            row.effects === 1 &&
            row.successes === 1 &&
            row.queue_state === "completed" &&
            row.retry_count === 1 &&
            state.postCommitFailureInjected &&
            state.outboxWrapperInvocations === 2
          );
        },
        60_000,
      );
    } catch (error) {
      if (!(error instanceof ReliableEventHarnessError)) {
        throw error;
      }
      const diagnostic = await queryScalar(
        client,
        `SELECT
           (SELECT count(*)::integer FROM outbox_effect_receipts
             WHERE outbox_event_id = $1 AND consumer_key = $2) AS effects,
           (SELECT count(*)::integer FROM outbox_dispatch_attempts
             WHERE outbox_event_id = $1 AND consumer_key = $2) AS attempts`,
        [fixture.outboxEventId, consumerKey],
      );
      const queueRows = await client.query(
        `SELECT state::text AS state, retry_count::integer AS retry_count
           FROM ${queueSchema}.job
          WHERE name = $1 ORDER BY created_on`,
        [RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch],
      );
      fail(
        `outbox replay diagnostic (effects=${diagnostic.effects}, attempts=${diagnostic.attempts}, dispatches=${state.externalDispatches}, wrappers=${state.outboxWrapperInvocations}, injected=${String(state.postCommitFailureInjected)}, errors=${[...state.outboxErrorCodes].join(",") || "none"}, states=${queueRows.rows.map((row) => `${row.state}:${row.retry_count}`).join(",") || "none"})`,
      );
    }
    await waitUntil("webhook retry dead letter", async () => {
      const row = await queryScalar(
        client,
        `SELECT
           (SELECT count(*)::integer
              FROM webhook_processing_attempts attempt
              JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
             WHERE inbox.provider_event_id = $1) AS attempts,
           (SELECT count(*)::integer
              FROM webhook_processing_attempts attempt
              JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
             WHERE inbox.provider_event_id = $1
               AND attempt.outcome = 'DEAD_LETTER') AS dead_letters,
           (SELECT count(*)::integer
              FROM ${queueSchema}.job job
              JOIN webhook_inbox inbox ON inbox.id = job.source_id
             WHERE inbox.provider_event_id = $1
               AND job.name = $2
               AND job.state = 'created') AS dlq_jobs`,
        [dlqEventId, RELIABLE_EVENT_QUEUE_NAMES.webhookDeadLetter],
      );
      return row.attempts === 6 && row.dead_letters === 1 && row.dlq_jobs === 1;
    });
  } catch (error) {
    processingFailure = error;
  }
  const stopResults = await Promise.allSettled(
    workers.map((worker) => worker.stop()),
  );
  if (processingFailure !== undefined) {
    throw processingFailure;
  }
  if (stopResults.some((result) => result.status === "rejected")) {
    fail("one or more VERIFY workers failed to stop cleanly");
  }
  assertEqual(
    state.outboxWrapperInvocations,
    2,
    "post-commit outbox job was not redelivered exactly once",
  );
  assert(
    state.postCommitFailureInjected,
    "post-commit pre-ACK failure was not injected",
  );
  assertEqual(
    state.externalDispatches,
    1,
    "post-commit redelivery repeated the external outbox dispatch",
  );
  const outboxCounts = await queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer FROM outbox_effect_receipts
         WHERE outbox_event_id = $1 AND consumer_key = $2) AS effects,
       (SELECT count(*)::integer FROM outbox_dispatch_attempts
         WHERE outbox_event_id = $1 AND consumer_key = $2
           AND outcome = 'SUCCEEDED') AS successes`,
    [fixture.outboxEventId, consumerKey],
  );
  assertEqual(outboxCounts.effects, 1, "outbox effect receipt was duplicated");
  assertEqual(
    outboxCounts.successes,
    1,
    "outbox success attempt was duplicated",
  );
  for (const outboxFixture of [
    webhookOutboxFixtures.concurrent,
    webhookOutboxFixtures.semanticReplay,
  ]) {
    const counts = await webhookOutboxCounts(client, outboxFixture);
    assertEqual(
      counts.candidates,
      1,
      `${outboxFixture.providerEventId} did not commit exactly one outbox candidate`,
    );
    assertEqual(
      counts.exact,
      1,
      `${outboxFixture.providerEventId} outbox metadata was not exact and versioned`,
    );
  }
  const rolledBackFailure = await queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer
          FROM webhook_effects effect
          JOIN webhook_inbox inbox ON inbox.id = effect.webhook_inbox_id
         WHERE inbox.provider_event_id = $1) AS effects,
       (SELECT count(*)::integer
          FROM webhook_processing_attempts attempt
          JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
         WHERE inbox.provider_event_id = $1) AS attempts,
       (SELECT count(*)::integer
          FROM webhook_processing_attempts attempt
          JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
         WHERE inbox.provider_event_id = $1
           AND attempt.outcome = 'SUCCEEDED') AS successes,
       (SELECT count(*)::integer
          FROM webhook_processing_attempts attempt
          JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
         WHERE inbox.provider_event_id = $1
           AND attempt.outcome = 'RETRYABLE_FAILURE') AS retryable_failures,
       (SELECT count(*)::integer
          FROM webhook_processing_attempts attempt
          JOIN webhook_inbox inbox ON inbox.id = attempt.webhook_inbox_id
         WHERE inbox.provider_event_id = $1
           AND attempt.outcome = 'DEAD_LETTER') AS dead_letters`,
    [dlqEventId],
  );
  const deadLetterOutbox = await webhookOutboxCounts(
    client,
    webhookOutboxFixtures.deadLetter,
  );
  assertEqual(
    state.outboxAppendsBeforeFailure,
    6,
    "the permanent failure did not occur after each transactional outbox append",
  );
  assertEqual(
    rolledBackFailure.effects,
    0,
    "a failed webhook handler committed its effect receipt",
  );
  assertEqual(
    deadLetterOutbox.candidates,
    0,
    "a failed webhook handler committed its outbox event",
  );
  assertEqual(
    rolledBackFailure.attempts,
    6,
    "failed webhook attempts were not committed independently",
  );
  assertEqual(
    rolledBackFailure.successes,
    0,
    "a failed webhook handler committed a successful attempt",
  );
  assertEqual(
    rolledBackFailure.retryable_failures,
    5,
    "retryable failure attempts were not committed independently",
  );
  assertEqual(
    rolledBackFailure.dead_letters,
    1,
    "the final independently committed attempt was not dead-lettered",
  );
  const concurrentEffects = await queryScalar(
    client,
    `SELECT
       count(effect.id)::integer AS effects,
       count(attempt.id) FILTER (WHERE attempt.outcome = 'SUCCEEDED')::integer AS successes
       FROM webhook_inbox inbox
       LEFT JOIN webhook_effects effect ON effect.webhook_inbox_id = inbox.id
       LEFT JOIN webhook_processing_attempts attempt
         ON attempt.webhook_inbox_id = inbox.id
      WHERE inbox.provider_event_id = $1`,
    [concurrentEventId],
  );
  assertEqual(
    concurrentEffects.effects,
    1,
    "ten-way webhook replay duplicated the database effect",
  );
  assertEqual(
    concurrentEffects.successes,
    1,
    "ten-way webhook replay duplicated the success attempt",
  );
  assertEqual(
    state.webhookHandlerCalls.get(concurrentEventId),
    1,
    "ten-way webhook replay did not execute one business handler action",
  );
  assertEqual(
    state.webhookHandlerCalls.get(semanticEventId),
    1,
    "semantic replay did not execute one business handler action",
  );
  assertEqual(
    state.webhookHandlerCalls.get(dlqEventId) ?? 0,
    0,
    "dead-lettered webhook executed a business handler action",
  );
}

async function runHarness(clientConfig) {
  let phase = "migrations";
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(clientConfig);
  const connection = connectionString(clientConfig);
  const provisionQueue = createPgBossReliableEventQueue({
    schemaVersion: 1,
    connectionString: connection,
    schema: queueSchema,
    managementMode: "PROVISION",
    localConcurrency: 1,
  });
  let persistence;
  try {
    phase = "connect";
    await client.connect();
    const receivedAt = timestampNow();
    phase = "seed";
    await seedConfiguration(client, receivedAt);
    phase = "provision";
    await provisionQueue.start();
    const schemaVersion = await queryScalar(
      client,
      `SELECT version::integer AS version FROM ${queueSchema}.version`,
    );
    assertEqual(schemaVersion.version, 40, "pg-boss schema is not version 40");
    persistence = createPostgresPersistence(clientConfig, {
      publishWebhookInbox: (transaction, job) =>
        provisionQueue.publishWebhookInbox(transaction, job),
    });
    phase = "ingress";
    const ingress = await assertIngressAndReceiptScenarios({
      client,
      persistence,
      receivedAt,
    });
    phase = "controlled-serializable-race";
    const controlledSerializableRace =
      await assertControlledSerializableReceiptRace({
        client,
        clientConfig,
        persistence,
        queue: provisionQueue,
        receivedAt,
      });
    phase = "publish-rollback";
    await assertPublishRollback({
      client,
      clientConfig,
      queue: provisionQueue,
      receivedAt,
    });
    phase = "outbox-relay";
    await publishOutboxFixture(persistence, provisionQueue, receivedAt);
    phase = "queue-envelope";
    await assertIdOnlyQueue(client);
    phase = "provision-stop";
    await provisionQueue.stop();
    phase = "workers";
    await assertWorkersAndDlq({
      client,
      persistence,
      connection,
      concurrentEventId: ingress.concurrentEventId,
      dlqEventId: ingress.dlqEventId,
      semanticEventId: ingress.semanticEventId,
    });
    return {
      concurrentReceipts: 10,
      concurrentReceiptDiagnosticsSafe:
        ingress.concurrentReceiptDiagnosticsSafe,
      controlledSerializableRace,
      workers: 2,
      maxAttempts: 6,
      outsideToleranceScenarios: ingress.outsideToleranceScenarios,
    };
  } catch (error) {
    if (error instanceof ReliableEventHarnessError) {
      throw error;
    }
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]{1,64}$|^[0-9]{5}$/u.test(error.code)
        ? error.code
        : "UNCLASSIFIED";
    throw new ReliableEventHarnessError(
      `reliable-event phase ${phase} failed (${code})`,
    );
  } finally {
    await provisionQueue.stop().catch(() => undefined);
    if (persistence !== undefined) {
      await persistence.close().catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

const startedAt = Date.now();
try {
  const result = await withEphemeralPostgres(async (clientConfig) => {
    try {
      const evidence = await runHarness(clientConfig);
      assertEqual(
        JSON.stringify({
          outsideToleranceScenarios: evidence.outsideToleranceScenarios,
          concurrentReceiptDiagnosticsSafe:
            evidence.concurrentReceiptDiagnosticsSafe,
          controlledSerializableRace: evidence.controlledSerializableRace,
        }),
        JSON.stringify({
          outsideToleranceScenarios: 2,
          concurrentReceiptDiagnosticsSafe: true,
          controlledSerializableRace: 1,
        }),
        "the reliable-event gate did not prove every terminal review scenario",
      );
      return evidence;
    } catch (error) {
      if (error instanceof ReliableEventHarnessError) {
        throw new EphemeralPostgresError(error.message);
      }
      throw new EphemeralPostgresError(
        "PostgreSQL reliable-event integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL reliable-event gate passed (${result.outsideToleranceScenarios} outside-tolerance rejections, ${result.concurrentReceipts} concurrent receipts with redacted diagnostics, ${result.controlledSerializableRace} controlled SERIALIZABLE race, ${result.workers} VERIFY workers, ${result.maxAttempts} finite attempts, ${Date.now() - startedAt} ms).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL reliable-event integration failed";
  console.error(message);
  process.exitCode = 1;
}
