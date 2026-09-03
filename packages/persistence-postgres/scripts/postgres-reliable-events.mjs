#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  createDispatchOutboxEvent,
  createListReadyOutboxJobs,
  createProcessWebhookInbox,
  createReceivePaymentWebhook,
} from "../../application/dist/index.js";
import { createFakePaymentWebhookVerifier } from "../../payment-fake/dist/index.js";
import {
  createPgBossReliableEventQueue,
  createPostgresPersistence,
  EphemeralPostgresError,
  RELIABLE_EVENT_QUEUE_NAMES,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

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
  verificationKeyReferenceHash: "7".repeat(64),
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
       (SELECT count(*)::integer FROM provider_event_associations) AS associations`,
  );
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

  const semanticEventId = "semantic-replay-event";
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

  const concurrentEventId = "ten-way-concurrent-event";
  const concurrentBody = paymentBody({ eventId: concurrentEventId });
  const concurrentResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      receive(commandFor(concurrentBody, receivedAt)),
    ),
  );
  assertEqual(
    concurrentResults.filter(
      (result) =>
        result.outcome === "SUCCESS" &&
        result.value.decision === "ACCEPTED_NEW",
    ).length,
    1,
    "concurrent receipt did not elect exactly one new event",
  );
  assert(
    concurrentResults.every(
      (result) =>
        result.outcome === "SUCCESS" ||
        (result.error.code === "TEMPORARY_UNAVAILABLE" &&
          result.error.recovery === "RETRY_SAME_COMMAND"),
    ),
    "concurrent receipt returned a non-retryable race failure",
  );
  const convergedResults = [];
  for (const result of concurrentResults) {
    convergedResults.push(
      result.outcome === "SUCCESS"
        ? result
        : await receive(commandFor(concurrentBody, receivedAt)),
    );
  }
  assert(
    convergedResults.every(
      (result) =>
        result.outcome === "SUCCESS" &&
        ["ACCEPTED_NEW", "ACCEPTED_REPLAY"].includes(result.value.decision),
    ),
    "retryable concurrent receipts did not converge to NEW/REPLAY",
  );
  const concurrentCounts = await queryScalar(
    client,
    `SELECT
       (SELECT count(*)::integer FROM webhook_inbox WHERE provider_event_id = $1) AS inbox,
       (SELECT count(*)::integer FROM provider_events WHERE provider_event_id = $1) AS events,
       (SELECT count(*)::integer
          FROM ${queueSchema}.job job
          JOIN webhook_inbox inbox ON inbox.id = job.id
         WHERE inbox.provider_event_id = $1) AS jobs`,
    [concurrentEventId],
  );
  assertEqual(
    concurrentCounts.inbox,
    1,
    "concurrent receipt duplicated inbox rows",
  );
  assertEqual(
    concurrentCounts.events,
    1,
    "concurrent receipt duplicated events",
  );
  assertEqual(
    concurrentCounts.jobs,
    1,
    "concurrent receipt duplicated queue jobs",
  );

  const dlqEventId = "finite-retry-dead-letter-event";
  const dlqBody = paymentBody({ eventId: dlqEventId });
  const dlqResult = await receive(commandFor(dlqBody, receivedAt));
  assertEqual(dlqResult.outcome, "SUCCESS", "DLQ fixture receipt failed");
  assertEqual(
    dlqResult.value.decision,
    "ACCEPTED_NEW",
    "DLQ fixture was not new",
  );

  return { concurrentEventId, dlqEventId };
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
      handle: async (context) => {
        if (context.event.providerEventId === dlqEventId) {
          throw new Error("test-only permanent handler failure");
        }
        state.webhookEffects += 1;
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
}) {
  const state = {
    webhookEffects: 0,
    externalDispatches: 0,
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
                 AND outcome = 'SUCCEEDED') AS successes`,
            [fixture.outboxEventId, consumerKey],
          );
          return row.effects === 1 && row.successes === 1;
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
        `SELECT state::text AS state FROM ${queueSchema}.job
          WHERE name = $1 ORDER BY created_on`,
        [RELIABLE_EVENT_QUEUE_NAMES.outboxDispatch],
      );
      fail(
        `outbox replay diagnostic (effects=${diagnostic.effects}, attempts=${diagnostic.attempts}, dispatches=${state.externalDispatches}, errors=${[...state.outboxErrorCodes].join(",") || "none"}, states=${queueRows.rows.map((row) => row.state).join(",") || "none"})`,
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
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
  }
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
    });
    return {
      concurrentReceipts: 10,
      workers: 2,
      maxAttempts: 6,
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
      return await runHarness(clientConfig);
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
    `PostgreSQL reliable-event gate passed (${result.concurrentReceipts} concurrent receipts, ${result.workers} VERIFY workers, ${result.maxAttempts} finite attempts, ${Date.now() - startedAt} ms).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL reliable-event integration failed";
  console.error(message);
  process.exitCode = 1;
}
