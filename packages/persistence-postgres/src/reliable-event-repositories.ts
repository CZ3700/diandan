import { Buffer } from "node:buffer";

import {
  listReadyOutboxEventsCommandSchema,
  listReadyOutboxEventsResponseSchema,
  loadOutboxDispatchContextCommandSchema,
  loadOutboxDispatchContextResponseSchema,
  loadPaymentWebhookEndpointCommandSchema,
  loadPaymentWebhookEndpointResponseSchema,
  loadWebhookProcessingContextCommandSchema,
  loadWebhookProcessingContextResponseSchema,
  paymentWebhookEndpointDescriptorSchema,
  PersistenceTransactionFailureError,
  purgeExpiredWebhookPayloadsCommandSchema,
  purgeExpiredWebhookPayloadsResponseSchema,
  recordOutboxDispatchAttemptCommandSchema,
  recordOutboxDispatchAttemptResponseSchema,
  recordOutboxEffectCommandSchema,
  recordOutboxEffectResponseSchema,
  recordVerifiedWebhookReceiptCommandSchema,
  recordVerifiedWebhookReceiptResponseSchema,
  recordWebhookEffectCommandSchema,
  recordWebhookEffectResponseSchema,
  recordWebhookProcessingAttemptCommandSchema,
  recordWebhookProcessingAttemptResponseSchema,
  type ListReadyOutboxEventsResponse,
  type LoadOutboxDispatchContextResponse,
  type LoadPaymentWebhookEndpointResponse,
  type LoadWebhookProcessingContextResponse,
  type PaymentWebhookEndpointDescriptor,
  type PurgeExpiredWebhookPayloadsResponse,
  type RecordOutboxDispatchAttemptCommand,
  type RecordOutboxDispatchAttemptResponse,
  type RecordOutboxEffectResponse,
  type RecordVerifiedWebhookReceiptCommand,
  type RecordVerifiedWebhookReceiptResponse,
  type RecordWebhookEffectResponse,
  type RecordWebhookProcessingAttemptCommand,
  type RecordWebhookProcessingAttemptResponse,
  type ReliableEventTransactionRepositories,
} from "@fan-support/persistence-port";

import { classifyPostgresFailure } from "./errors.js";
import {
  createPersistenceTransactionFailureError,
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export type ReliableEventRepositorySet = Omit<
  ReliableEventTransactionRepositories,
  "outbox"
>;

export type WebhookInboxPublisher = (
  client: TransactionClient,
  job: RecordVerifiedWebhookReceiptCommand["job"],
) => Promise<void>;

export type ReliableEventRepositoryDependencies = Readonly<{
  transactionScope: TransactionScopeControl;
  publishWebhookInbox: WebhookInboxPublisher;
}>;

type QueryRow = Readonly<Record<string, unknown>>;
type OperationQueue = { tail: Promise<void>; nextSavepointId: bigint };
type ProviderEvent = Extract<
  LoadWebhookProcessingContextResponse["value"],
  { decision: "READY" }
>["event"];
type EventEnvelope = Extract<
  LoadOutboxDispatchContextResponse["value"],
  { decision: "READY" }
>["event"];

const operationQueues = new WeakMap<TransactionClient, OperationQueue>();
const concurrentReceiptConstraints = new Set([
  "webhook_inbox_provider_event_unique",
  "provider_events_provider_event_unique",
]);

function failure(
  code:
    | "INVALID_COMMAND"
    | "NOT_FOUND"
    | "ALREADY_EXISTS"
    | "IDEMPOTENCY_CONFLICT"
    | "INTEGRITY_VIOLATION"
    | "CONFIGURATION_ERROR",
): PersistenceTransactionFailureError {
  return createPersistenceTransactionFailureError({
    code,
    recovery: "NONE",
  });
}

function normalizeFailure(error: unknown): PersistenceTransactionFailureError {
  return error instanceof PersistenceTransactionFailureError
    ? error
    : persistenceTransactionFailureFromPostgres(error);
}

function postgresConstraint(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "constraint");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function readRows(result: unknown): readonly QueryRow[] {
  if (typeof result !== "object" || result === null) {
    throw failure("CONFIGURATION_ERROR");
  }
  const descriptor = Object.getOwnPropertyDescriptor(result, "rows");
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    !Array.isArray(descriptor.value) ||
    descriptor.value.some(
      (row) => typeof row !== "object" || row === null || Array.isArray(row),
    )
  ) {
    throw failure("CONFIGURATION_ERROR");
  }
  return descriptor.value as QueryRow[];
}

async function queryRows(
  client: TransactionClient,
  text: string,
  values: readonly unknown[],
): Promise<readonly QueryRow[]> {
  return readRows(await client.query(text, [...values]));
}

function requiredString(row: QueryRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw failure("INTEGRITY_VIOLATION");
  }
  return value;
}

function nullableString(row: QueryRow, key: string): string | null {
  const value = row[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw failure("INTEGRITY_VIOLATION");
  }
  return value;
}

function requiredBoolean(row: QueryRow, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw failure("INTEGRITY_VIOLATION");
  }
  return value;
}

function integer(row: QueryRow, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw failure("INTEGRITY_VIOLATION");
}

function positiveInteger(row: QueryRow, key: string): number {
  const parsed = integer(row, key);
  if (parsed < 1) {
    throw failure("INTEGRITY_VIOLATION");
  }
  return parsed;
}

function nonnegativeInteger(row: QueryRow, key: string): number {
  const parsed = integer(row, key);
  if (parsed < 0) {
    throw failure("INTEGRITY_VIOLATION");
  }
  return parsed;
}

function timestamp(row: QueryRow, key: string): string {
  const value = row[key];
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return value;
  }
  throw failure("INTEGRITY_VIOLATION");
}

function timestampInstant(
  value: string,
): Readonly<{ seconds: number; fraction: string }> | undefined {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (match === null || match[1] === undefined || match[3] === undefined) {
    return undefined;
  }
  const milliseconds = Date.parse(`${match[1]}.000${match[3]}`);
  if (!Number.isFinite(milliseconds)) {
    return undefined;
  }
  return {
    seconds: Math.floor(milliseconds / 1_000),
    fraction: (match[2] ?? "").replace(/0+$/u, ""),
  };
}

function compareTimestamps(left: string, right: string): number | undefined {
  const leftInstant = timestampInstant(left);
  const rightInstant = timestampInstant(right);
  if (leftInstant === undefined || rightInstant === undefined) {
    return undefined;
  }
  if (leftInstant.seconds !== rightInstant.seconds) {
    return leftInstant.seconds < rightInstant.seconds ? -1 : 1;
  }
  const width = Math.max(
    leftInstant.fraction.length,
    rightInstant.fraction.length,
  );
  const leftFraction = leftInstant.fraction.padEnd(width, "0");
  const rightFraction = rightInstant.fraction.padEnd(width, "0");
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction < rightFraction ? -1 : 1;
}

function timestampsEqual(left: string, right: string): boolean {
  return compareTimestamps(left, right) === 0;
}

function hasPostgresTimestampPrecision(value: string): boolean {
  return (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1]?.length ?? 0) <= 6;
}

function timestampMatches(
  row: QueryRow,
  key: string,
  expected: string,
): boolean {
  const databaseMatch = row[`${key}_matches`];
  return databaseMatch === undefined
    ? timestampsEqual(timestamp(row, key), expected)
    : requiredBoolean(row, `${key}_matches`);
}

function queueFor(client: TransactionClient): OperationQueue {
  const existing = operationQueues.get(client);
  if (existing !== undefined) {
    return existing;
  }
  const created: OperationQueue = {
    tail: Promise.resolve(),
    nextSavepointId: 0n,
  };
  operationQueues.set(client, created);
  return created;
}

async function runQueuedOperation<Result>(
  client: TransactionClient,
  transactionScope: TransactionScopeControl,
  work: () => Promise<Result>,
): Promise<Result> {
  return transactionScope.trackOperation(async () => {
    const queue = queueFor(client);
    const predecessor = queue.tail;
    let releaseTurn!: () => void;
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const queuedTail = predecessor.then(() => turn);
    queue.tail = queuedTail;
    queue.nextSavepointId += 1n;
    const savepoint = `reliable_event_operation_${queue.nextSavepointId}`;
    await predecessor;
    try {
      try {
        await client.query(`savepoint ${savepoint}`);
      } catch (error: unknown) {
        throw normalizeFailure(error);
      }
      try {
        const result = await work();
        await client.query(`release savepoint ${savepoint}`);
        return result;
      } catch (error: unknown) {
        try {
          await client.query(`rollback to savepoint ${savepoint}`);
          await client.query(`release savepoint ${savepoint}`);
        } catch (boundaryError: unknown) {
          throw normalizeFailure(boundaryError);
        }
        throw normalizeFailure(error);
      }
    } finally {
      releaseTurn();
      if (queue.tail === queuedTail) {
        operationQueues.delete(client);
      }
    }
  });
}

function rejectTrackedOperation<Result>(
  transactionScope: TransactionScopeControl,
  code: "INVALID_COMMAND" | "CONFIGURATION_ERROR",
): Promise<Result> {
  return transactionScope.trackOperation(async () => {
    throw failure(code);
  });
}

async function loadEndpointDescriptor(
  client: TransactionClient,
  endpointId: string,
  receivedAt: string,
  lock: boolean,
): Promise<PaymentWebhookEndpointDescriptor | undefined> {
  const rows = await queryRows(
    client,
    `/* reliable-event:load-endpoint */
     select endpoint.id::text as endpoint_id,
            endpoint.provider_account_id::text as provider_account_id,
            endpoint.environment,
            account.adapter_key,
            endpoint.verification_key_reference_hash,
            endpoint.status,
            to_char(
              endpoint.active_from at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) as active_from,
            to_char(
              endpoint.overlap_started_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) as overlap_started_at,
            to_char(
              endpoint.retired_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) as retired_at
       from public.payment_webhook_endpoints endpoint
       join public.payment_provider_accounts account
         on account.id = endpoint.provider_account_id
        and account.environment = endpoint.environment
      where endpoint.id = $1::uuid
        and account.status in ('INTERNAL', 'ACTIVE')
        and endpoint.status in ('ACTIVE', 'ROTATION_OVERLAP')
        and endpoint.active_from <= $2::timestamptz
        and (
          (endpoint.status = 'ACTIVE' and endpoint.retired_at is null)
          or (endpoint.status = 'ROTATION_OVERLAP'
              and endpoint.overlap_started_at <= $2::timestamptz
              and endpoint.retired_at > $2::timestamptz)
        )
      ${lock ? "for share of endpoint, account" : ""}`,
    [endpointId, receivedAt],
  );
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw failure("INTEGRITY_VIOLATION");
  }
  const row = rows[0];
  if (row === undefined) {
    throw failure("INTEGRITY_VIOLATION");
  }
  const status = requiredString(row, "status");
  const lifecycle = (() => {
    switch (status) {
      case "ACTIVE":
        return { status, activeFrom: timestamp(row, "active_from") };
      case "ROTATION_OVERLAP":
        return {
          status,
          activeFrom: timestamp(row, "active_from"),
          overlapStartedAt: timestamp(row, "overlap_started_at"),
          retiredAt: timestamp(row, "retired_at"),
        };
      default:
        throw failure("INTEGRITY_VIOLATION");
    }
  })();
  const parsed = paymentWebhookEndpointDescriptorSchema.safeParse({
    schemaVersion: 1,
    endpointId: requiredString(row, "endpoint_id"),
    providerAccountId: requiredString(row, "provider_account_id"),
    environment: requiredString(row, "environment"),
    adapterKey: requiredString(row, "adapter_key"),
    verificationKeyReferenceHash: requiredString(
      row,
      "verification_key_reference_hash",
    ),
    lifecycle,
  });
  if (!parsed.success) {
    throw failure("INTEGRITY_VIOLATION");
  }
  return parsed.data;
}

function sameEndpoint(
  left: PaymentWebhookEndpointDescriptor,
  right: PaymentWebhookEndpointDescriptor,
): boolean {
  if (
    left.endpointId !== right.endpointId ||
    left.providerAccountId !== right.providerAccountId ||
    left.environment !== right.environment ||
    left.adapterKey !== right.adapterKey ||
    left.verificationKeyReferenceHash !== right.verificationKeyReferenceHash ||
    left.lifecycle.status !== right.lifecycle.status ||
    !timestampsEqual(left.lifecycle.activeFrom, right.lifecycle.activeFrom)
  ) {
    return false;
  }
  return left.lifecycle.status === "ACTIVE" &&
    right.lifecycle.status === "ACTIVE"
    ? true
    : left.lifecycle.status === "ROTATION_OVERLAP" &&
        right.lifecycle.status === "ROTATION_OVERLAP" &&
        timestampsEqual(
          left.lifecycle.overlapStartedAt,
          right.lifecycle.overlapStartedAt,
        ) &&
        timestampsEqual(left.lifecycle.retiredAt, right.lifecycle.retiredAt);
}

async function loadProviderEvent(
  client: TransactionClient,
  providerAccountId: string,
  environment: string,
  providerEventReference: string,
  occurredAt: string,
): Promise<QueryRow | undefined> {
  const rows = await queryRows(
    client,
    `/* reliable-event:load-provider-event */
     select inbox.id::text as webhook_inbox_id,
            event.id::text as provider_event_row_id,
            event.provider_account_id::text as provider_account_id,
            event.environment,
            event.provider_event_id as provider_event_reference,
            event.event_type,
            event.normalized_status,
            event.external_payment_reference,
            event.provider_refund_reference,
            event.provider_dispute_reference,
            event.provider_transaction_type,
            event.provider_transaction_reference,
            event.amount_minor::text as amount_minor,
            event.currency,
            event.occurred_at,
            event.occurred_at = $4::timestamptz as occurred_at_matches,
            association.association_status,
            association.payment_attempt_id::text as payment_attempt_id,
            association.reason_code as association_reason_code
       from public.provider_events event
       join public.webhook_inbox inbox on inbox.id = event.webhook_inbox_id
       left join lateral (
         select candidate.association_status,
                candidate.payment_attempt_id,
                candidate.reason_code
           from public.provider_event_associations candidate
          where candidate.provider_event_id = event.id
          order by (candidate.association_status = 'MATCHED') desc,
                   candidate.created_at desc
          limit 1
       ) association on true
      where event.provider_account_id = $1::uuid
        and event.environment = $2
        and event.provider_event_id = $3
      for update of event, inbox`,
    [providerAccountId, environment, providerEventReference, occurredAt],
  );
  if (rows.length > 1) {
    throw failure("INTEGRITY_VIOLATION");
  }
  return rows[0];
}

function semanticEventMatches(
  row: QueryRow,
  command: RecordVerifiedWebhookReceiptCommand,
): boolean {
  const candidate = command.candidate;
  const refundReference =
    candidate.eventType === "REFUND_STATUS" ? candidate.refundReference : null;
  const disputeReference =
    candidate.eventType === "DISPUTE_STATUS"
      ? candidate.disputeReference
      : null;
  return (
    requiredString(row, "provider_account_id") ===
      command.endpoint.providerAccountId &&
    requiredString(row, "environment") === command.endpoint.environment &&
    requiredString(row, "provider_event_reference") ===
      candidate.providerEventId &&
    requiredString(row, "event_type") === candidate.eventType &&
    requiredString(row, "normalized_status") === candidate.status &&
    requiredString(row, "external_payment_reference") ===
      candidate.externalReference &&
    nullableString(row, "provider_refund_reference") === refundReference &&
    nullableString(row, "provider_dispute_reference") === disputeReference &&
    nullableString(row, "provider_transaction_type") ===
      (candidate.transaction?.type ?? null) &&
    nullableString(row, "provider_transaction_reference") ===
      (candidate.transaction?.providerReference ?? null) &&
    nonnegativeInteger(row, "amount_minor") === candidate.amountMinor &&
    requiredString(row, "currency") === candidate.currency &&
    timestampMatches(row, "occurred_at", candidate.occurredAt)
  );
}

function receiptReplayResponse(
  row: QueryRow,
  command: RecordVerifiedWebhookReceiptCommand,
): RecordVerifiedWebhookReceiptResponse {
  return recordVerifiedWebhookReceiptResponseSchema.parse(
    semanticEventMatches(row, command)
      ? {
          schemaVersion: 1,
          operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
          outcome: "SUCCESS",
          value: {
            decision: "REPLAY",
            webhookInboxId: requiredString(row, "webhook_inbox_id"),
            providerEventRowId: requiredString(row, "provider_event_row_id"),
            providerAccountId: requiredString(row, "provider_account_id"),
            environment: requiredString(row, "environment"),
            providerEventId: requiredString(row, "provider_event_reference"),
          },
        }
      : {
          schemaVersion: 1,
          operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
          outcome: "SUCCESS",
          value: {
            decision: "CONFLICT",
            conflictCode: "PROVIDER_EVENT_IDENTITY_MISMATCH",
          },
        },
  );
}

function encryptedBytes(value: string): Uint8Array {
  return Buffer.from(value.slice("enc:v1:".length), "base64url");
}

function exactlyOneId(rows: readonly QueryRow[], expectedId: string): void {
  if (
    rows.length !== 1 ||
    rows[0] === undefined ||
    requiredString(rows[0], "id") !== expectedId
  ) {
    throw failure("INTEGRITY_VIOLATION");
  }
}

function optionalErrorCode(
  command:
    RecordWebhookProcessingAttemptCommand | RecordOutboxDispatchAttemptCommand,
): string | null {
  return command.outcome === "SUCCEEDED" ? null : command.errorCode;
}

function attemptedRecordMatches(
  row: QueryRow,
  command:
    RecordWebhookProcessingAttemptCommand | RecordOutboxDispatchAttemptCommand,
  ownerKey: "webhook_inbox_id" | "outbox_event_id",
  ownerId: string,
  consumerKey?: string,
): boolean {
  return (
    requiredString(row, ownerKey) === ownerId &&
    (consumerKey === undefined ||
      requiredString(row, "consumer_key") === consumerKey) &&
    positiveInteger(row, "attempt_number") === command.attemptNumber &&
    requiredString(row, "outcome") === command.outcome &&
    nullableString(row, "error_code") === optionalErrorCode(command) &&
    timestampMatches(row, "started_at", command.startedAt) &&
    timestampMatches(row, "finished_at", command.finishedAt)
  );
}

async function insertVerifiedReceipt(
  client: TransactionClient,
  command: RecordVerifiedWebhookReceiptCommand,
  publishWebhookInbox: WebhookInboxPublisher,
): Promise<RecordVerifiedWebhookReceiptResponse> {
  await client.query("savepoint reliable_event_receipt_insert");
  try {
    exactlyOneId(
      await queryRows(
        client,
        `/* reliable-event:insert-webhook-payload */
         insert into public.webhook_payloads (
           id, schema_version, payload_ciphertext, encrypted_data_key,
           encryption_key_version, payload_sha256, status,
           retention_expires_at
         ) values ($1::uuid, 1, $2::bytea, $3::bytea, $4, $5, 'RETAINED',
                   $6::timestamptz)
         returning id::text as id`,
        [
          command.webhookPayload.webhookPayloadId,
          encryptedBytes(command.webhookPayload.ciphertext),
          encryptedBytes(command.webhookPayload.encryptedDataKey),
          command.webhookPayload.encryptionKeyVersion,
          command.webhookPayload.payloadSha256,
          command.webhookPayload.retentionExpiresAt,
        ],
      ),
      command.webhookPayload.webhookPayloadId,
    );

    exactlyOneId(
      await queryRows(
        client,
        `/* reliable-event:insert-webhook-inbox */
         insert into public.webhook_inbox (
           id, schema_version, provider_account_id, environment, endpoint_id,
           provider_event_id, webhook_payload_id, payload_sha256,
           signature_verified, verification_key_reference_hash,
           signature_timestamp, received_at
         ) values (
           $1::uuid, 1, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7,
           true, $8, $9::timestamptz, transaction_timestamp()
         )
         returning id::text as id`,
        [
          command.webhookInboxId,
          command.endpoint.providerAccountId,
          command.endpoint.environment,
          command.endpoint.endpointId,
          command.candidate.providerEventId,
          command.webhookPayload.webhookPayloadId,
          command.webhookPayload.payloadSha256,
          command.endpoint.verificationKeyReferenceHash,
          command.signatureTimestamp,
        ],
      ),
      command.webhookInboxId,
    );

    const candidate = command.candidate;
    exactlyOneId(
      await queryRows(
        client,
        `/* reliable-event:insert-provider-event */
         insert into public.provider_events (
           id, schema_version, provider_account_id, environment,
           provider_event_id, evidence_kind, webhook_inbox_id, event_type,
           normalized_status, external_payment_reference,
           provider_refund_reference, provider_dispute_reference,
           provider_transaction_type, provider_transaction_reference,
           amount_minor, currency, occurred_at
         ) select
           $1::uuid, 1, $2::uuid, $3, $4, 'VERIFIED_WEBHOOK', $5::uuid,
           $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz
          where $15::timestamptz <= transaction_timestamp()
         returning id::text as id`,
        [
          command.providerEventRowId,
          command.endpoint.providerAccountId,
          command.endpoint.environment,
          candidate.providerEventId,
          command.webhookInboxId,
          candidate.eventType,
          candidate.status,
          candidate.externalReference,
          candidate.eventType === "REFUND_STATUS"
            ? candidate.refundReference
            : null,
          candidate.eventType === "DISPUTE_STATUS"
            ? candidate.disputeReference
            : null,
          candidate.transaction?.type ?? null,
          candidate.transaction?.providerReference ?? null,
          candidate.amountMinor,
          candidate.currency,
          candidate.occurredAt,
        ],
      ),
      command.providerEventRowId,
    );

    exactlyOneId(
      await queryRows(
        client,
        `/* reliable-event:insert-provider-association */
         insert into public.provider_event_associations (
           id, schema_version, provider_event_id, association_status,
           payment_attempt_id, reason_code
         ) values ($1::uuid, 1, $2::uuid, $3, $4::uuid, $5)
         returning id::text as id`,
        [
          command.association.associationId,
          command.providerEventRowId,
          command.association.status,
          command.association.status === "MATCHED"
            ? command.association.paymentAttemptId
            : null,
          command.association.reasonCode,
        ],
      ),
      command.association.associationId,
    );
    await client.query("release savepoint reliable_event_receipt_insert");
  } catch (error: unknown) {
    await client.query("rollback to savepoint reliable_event_receipt_insert");
    await client.query("release savepoint reliable_event_receipt_insert");
    if (classifyPostgresFailure(error).code !== "ALREADY_EXISTS") {
      throw error;
    }
    const existing = await loadProviderEvent(
      client,
      command.endpoint.providerAccountId,
      command.endpoint.environment,
      command.candidate.providerEventId,
      command.candidate.occurredAt,
    );
    if (existing === undefined) {
      if (concurrentReceiptConstraints.has(postgresConstraint(error) ?? "")) {
        throw createPersistenceTransactionFailureError({
          code: "TRANSACTION_ABORTED",
          recovery: "RETRY_SAME_COMMAND",
          retryAfterMs: 250,
        });
      }
      throw error;
    }
    return receiptReplayResponse(existing, command);
  }

  await publishWebhookInbox(client, command.job);
  return recordVerifiedWebhookReceiptResponseSchema.parse({
    schemaVersion: 1,
    operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    outcome: "SUCCESS",
    value: {
      decision: "NEW",
      webhookInboxId: command.webhookInboxId,
      providerEventRowId: command.providerEventRowId,
      providerAccountId: command.endpoint.providerAccountId,
      environment: command.endpoint.environment,
      providerEventId: command.candidate.providerEventId,
      jobEnqueued: true,
    },
  });
}

function providerEventFromRow(row: QueryRow): ProviderEvent {
  const eventType = requiredString(row, "event_type");
  const associationStatus = requiredString(row, "association_status");
  const externalReference = requiredString(row, "external_payment_reference");
  const transactionType = nullableString(row, "provider_transaction_type");
  const transactionReference = nullableString(
    row,
    "provider_transaction_reference",
  );
  if (
    (transactionType === null) !== (transactionReference === null) ||
    (associationStatus !== "MATCHED" && associationStatus !== "UNMATCHED")
  ) {
    throw failure("INTEGRITY_VIOLATION");
  }
  const base = {
    schemaVersion: 1,
    providerAccountId: requiredString(row, "provider_account_id"),
    environment: requiredString(row, "environment"),
    providerEventId: requiredString(row, "provider_event_reference"),
    evidence: {
      kind: "VERIFIED_WEBHOOK",
      webhookInboxId: requiredString(row, "webhook_inbox_id"),
    },
    occurredAt: timestamp(row, "occurred_at"),
    association:
      associationStatus === "MATCHED"
        ? {
            status: "MATCHED",
            paymentAttemptId: requiredString(row, "payment_attempt_id"),
            externalReference,
          }
        : { status: "UNMATCHED", externalReference },
    ...(transactionType === null || transactionReference === null
      ? {}
      : {
          transaction: {
            type: transactionType,
            providerReference: transactionReference,
          },
        }),
  };
  const status = requiredString(row, "normalized_status");
  const common = {
    ...base,
    status,
    amountMinor: nonnegativeInteger(row, "amount_minor"),
    currency: requiredString(row, "currency"),
  };
  const input = (() => {
    switch (eventType) {
      case "PAYMENT_STATUS":
        return { ...common, eventType };
      case "REFUND_STATUS":
        return {
          ...common,
          eventType,
          refundReference: requiredString(row, "provider_refund_reference"),
        };
      case "DISPUTE_STATUS":
        return {
          ...common,
          eventType,
          disputeReference: requiredString(row, "provider_dispute_reference"),
        };
      default:
        throw failure("INTEGRITY_VIOLATION");
    }
  })();
  const parsed = loadWebhookProcessingContextResponseSchema.safeParse({
    schemaVersion: 1,
    operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
    outcome: "SUCCESS",
    value: {
      decision: "READY",
      webhookInboxId: requiredString(row, "webhook_inbox_id"),
      providerEventRowId: requiredString(row, "provider_event_row_id"),
      event: input,
      nextAttemptNumber: positiveInteger(row, "next_attempt_number"),
    },
  });
  if (!parsed.success || parsed.data.value.decision !== "READY") {
    throw failure("INTEGRITY_VIOLATION");
  }
  return parsed.data.value.event;
}

function outboxEventFromRow(row: QueryRow): EventEnvelope {
  const eventType = requiredString(row, "event_type");
  const aggregateId = requiredString(row, "aggregate_id");
  const primarySubjectId = requiredString(row, "primary_subject_id");
  const secondarySubjectId = nullableString(row, "secondary_subject_id");
  const causationId = nullableString(row, "causation_id");
  const traceId = nullableString(row, "trace_id");
  const base = {
    schemaVersion: 1,
    eventId: requiredString(row, "outbox_event_id"),
    aggregateId,
    occurredAt: timestamp(row, "occurred_at"),
    correlationId: requiredString(row, "correlation_id"),
    requestId: requiredString(row, "request_id"),
    ...(causationId === null ? {} : { causationId }),
    ...(traceId === null ? {} : { traceId }),
  };
  const requiredSecondarySubjectId = (): string => {
    if (secondarySubjectId === null) {
      throw failure("INTEGRITY_VIOLATION");
    }
    return secondarySubjectId;
  };
  const input = (() => {
    switch (eventType) {
      case "CART_ITEM_ADDED":
        return {
          ...base,
          eventType,
          payload: {
            cartId: primarySubjectId,
            cartItemId: requiredSecondarySubjectId(),
          },
        };
      case "CONTENT_PUBLICATION_CHANGED":
        return {
          ...base,
          eventType,
          locale: requiredString(row, "locale"),
          payload: { contentPublicationId: primarySubjectId },
        };
      case "PAYMENT_STATUS_CHANGED":
        return {
          ...base,
          eventType,
          payload: {
            paymentAttemptId: primarySubjectId,
            orderId: requiredSecondarySubjectId(),
            status: requiredString(row, "payload_status"),
          },
        };
      case "ORDER_PAYMENT_CONFIRMED":
        return {
          ...base,
          eventType,
          payload: {
            orderId: primarySubjectId,
            paymentAttemptId: requiredSecondarySubjectId(),
          },
        };
      case "REFUND_STATUS_CHANGED":
        return {
          ...base,
          eventType,
          payload: {
            refundId: primarySubjectId,
            orderId: requiredSecondarySubjectId(),
            status: requiredString(row, "payload_status"),
          },
        };
      case "DISPUTE_STATUS_CHANGED":
        return {
          ...base,
          eventType,
          payload: {
            disputeId: primarySubjectId,
            orderId: requiredSecondarySubjectId(),
            status: requiredString(row, "payload_status"),
          },
        };
      case "FULFILLMENT_STATUS_CHANGED":
        return {
          ...base,
          eventType,
          payload: {
            fulfillmentId: primarySubjectId,
            orderId: requiredSecondarySubjectId(),
            status: requiredString(row, "payload_status"),
          },
        };
      case "NOTIFICATION_REQUESTED":
        return {
          ...base,
          eventType,
          payload: {
            notificationDeliveryId: primarySubjectId,
            orderId: requiredSecondarySubjectId(),
          },
        };
      case "PAYMENT_CONFIG_PUBLISHED":
        return {
          ...base,
          eventType,
          payload: {
            paymentConfigVersionId: aggregateId,
            paymentConfigPublicationId: primarySubjectId,
          },
        };
      case "PRICE_BOOK_PUBLISHED":
        return {
          ...base,
          eventType,
          payload: {
            priceBookPublicationId: primarySubjectId,
            priceBookId: requiredSecondarySubjectId(),
            priceBookRevision: positiveInteger(row, "aggregate_version"),
            market: requiredString(row, "market"),
            currency: requiredString(row, "currency"),
          },
        };
      default:
        throw failure("INTEGRITY_VIOLATION");
    }
  })();
  const market = nullableString(row, "market");
  const currency = nullableString(row, "currency");
  const parsed = loadOutboxDispatchContextResponseSchema.safeParse({
    schemaVersion: 1,
    operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
    outcome: "SUCCESS",
    value: {
      decision: "READY",
      outboxEventId: requiredString(row, "outbox_event_id"),
      consumerKey: "placeholder-consumer",
      event: input,
      aggregateVersion: positiveInteger(row, "aggregate_version"),
      primarySubjectId,
      ...(secondarySubjectId === null ? {} : { secondarySubjectId }),
      ...(market === null ? {} : { market }),
      ...(currency === null ? {} : { currency }),
      nextAttemptNumber: positiveInteger(row, "next_attempt_number"),
    },
  });
  if (!parsed.success || parsed.data.value.decision !== "READY") {
    throw failure("INTEGRITY_VIOLATION");
  }
  return parsed.data.value.event;
}

function webhookAttemptResponse(
  command: RecordWebhookProcessingAttemptCommand,
  decision: "RECORDED" | "REPLAY",
  processingAttemptId: string = command.processingAttemptId,
): RecordWebhookProcessingAttemptResponse {
  return recordWebhookProcessingAttemptResponseSchema.parse({
    schemaVersion: 1,
    operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
    outcome: "SUCCESS",
    value: {
      decision,
      processingAttemptId,
      webhookInboxId: command.webhookInboxId,
      attemptNumber: command.attemptNumber,
    },
  });
}

function outboxAttemptResponse(
  command: RecordOutboxDispatchAttemptCommand,
  decision: "RECORDED" | "REPLAY",
  dispatchAttemptId: string = command.dispatchAttemptId,
): RecordOutboxDispatchAttemptResponse {
  return recordOutboxDispatchAttemptResponseSchema.parse({
    schemaVersion: 1,
    operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
    outcome: "SUCCESS",
    value: {
      decision,
      dispatchAttemptId,
      outboxEventId: command.outboxEventId,
      consumerKey: command.consumerKey,
      attemptNumber: command.attemptNumber,
    },
  });
}

export function createReliableEventRepositories(
  client: TransactionClient,
  dependencies: ReliableEventRepositoryDependencies,
): ReliableEventRepositorySet {
  const { transactionScope, publishWebhookInbox } = dependencies;
  return {
    paymentWebhookEndpoints: {
      async load(command): Promise<LoadPaymentWebhookEndpointResponse> {
        const parsed =
          loadPaymentWebhookEndpointCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const endpoint = await loadEndpointDescriptor(
            client,
            parsed.data.endpointId,
            parsed.data.receivedAt,
            false,
          );
          return loadPaymentWebhookEndpointResponseSchema.parse({
            schemaVersion: 1,
            operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
            outcome: "SUCCESS",
            value:
              endpoint === undefined
                ? { decision: "UNAVAILABLE" }
                : { decision: "ELIGIBLE", endpoint },
          });
        });
      },
    },
    verifiedWebhookReceipts: {
      async record(command): Promise<RecordVerifiedWebhookReceiptResponse> {
        const parsed =
          recordVerifiedWebhookReceiptCommandSchema.safeParse(command);
        if (
          !parsed.success ||
          (parsed.data.association.status === "MATCHED" &&
            parsed.data.candidate.transaction !== undefined) ||
          !hasPostgresTimestampPrecision(parsed.data.candidate.occurredAt) ||
          (compareTimestamps(
            parsed.data.candidate.occurredAt,
            parsed.data.receivedAt,
          ) ?? 1) > 0
        ) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const currentEndpoint = await loadEndpointDescriptor(
            client,
            parsed.data.endpoint.endpointId,
            parsed.data.receivedAt,
            true,
          );
          if (
            currentEndpoint === undefined ||
            !sameEndpoint(currentEndpoint, parsed.data.endpoint)
          ) {
            throw failure("NOT_FOUND");
          }
          const existing = await loadProviderEvent(
            client,
            parsed.data.endpoint.providerAccountId,
            parsed.data.endpoint.environment,
            parsed.data.candidate.providerEventId,
            parsed.data.candidate.occurredAt,
          );
          if (existing !== undefined) {
            return receiptReplayResponse(existing, parsed.data);
          }
          return insertVerifiedReceipt(
            client,
            parsed.data,
            publishWebhookInbox,
          );
        });
      },
    },
    webhookProcessing: {
      async loadContext(
        command,
      ): Promise<LoadWebhookProcessingContextResponse> {
        const parsed =
          loadWebhookProcessingContextCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const rows = await queryRows(
            client,
            `/* reliable-event:load-webhook-context */
             select inbox.id::text as webhook_inbox_id,
                    event.id::text as provider_event_row_id,
                    event.provider_account_id::text as provider_account_id,
                    event.environment,
                    event.provider_event_id as provider_event_reference,
                    event.event_type,
                    event.normalized_status,
                    event.external_payment_reference,
                    event.provider_refund_reference,
                    event.provider_dispute_reference,
                    event.provider_transaction_type,
                    event.provider_transaction_reference,
                    event.amount_minor::text as amount_minor,
                    event.currency,
                    to_char(
                      event.occurred_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) as occurred_at,
                    association.association_status,
                    association.payment_attempt_id::text as payment_attempt_id,
                    association.reason_code as association_reason_code,
                    exists (
                      select 1 from public.webhook_processing_attempts attempt
                       where attempt.webhook_inbox_id = inbox.id
                         and attempt.outcome = 'SUCCEEDED'
                    ) as already_processed,
                    coalesce((
                      select max(attempt.attempt_number) + 1
                        from public.webhook_processing_attempts attempt
                       where attempt.webhook_inbox_id = inbox.id
                    ), 1)::text as next_attempt_number
               from public.webhook_inbox inbox
               join public.provider_events event
                 on event.webhook_inbox_id = inbox.id
               join lateral (
                 select candidate.association_status,
                        candidate.payment_attempt_id,
                        candidate.reason_code
                   from public.provider_event_associations candidate
                  where candidate.provider_event_id = event.id
                  order by (candidate.association_status = 'MATCHED') desc,
                           candidate.created_at desc
                  limit 1
               ) association on true
              where inbox.id = $1::uuid`,
            [parsed.data.webhookInboxId],
          );
          if (rows.length === 0) {
            throw failure("NOT_FOUND");
          }
          if (rows.length !== 1 || rows[0] === undefined) {
            throw failure("INTEGRITY_VIOLATION");
          }
          const row = rows[0];
          const base = {
            schemaVersion: 1,
            operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
            outcome: "SUCCESS",
            value: requiredBoolean(row, "already_processed")
              ? {
                  decision: "ALREADY_PROCESSED",
                  webhookInboxId: requiredString(row, "webhook_inbox_id"),
                  providerEventRowId: requiredString(
                    row,
                    "provider_event_row_id",
                  ),
                }
              : {
                  decision: "READY",
                  webhookInboxId: requiredString(row, "webhook_inbox_id"),
                  providerEventRowId: requiredString(
                    row,
                    "provider_event_row_id",
                  ),
                  event: providerEventFromRow(row),
                  nextAttemptNumber: positiveInteger(
                    row,
                    "next_attempt_number",
                  ),
                },
          };
          const response =
            loadWebhookProcessingContextResponseSchema.safeParse(base);
          if (!response.success) {
            throw failure("INTEGRITY_VIOLATION");
          }
          return response.data;
        });
      },
      async recordAttempt(
        command,
      ): Promise<RecordWebhookProcessingAttemptResponse> {
        const parsed =
          recordWebhookProcessingAttemptCommandSchema.safeParse(command);
        if (
          !parsed.success ||
          !hasPostgresTimestampPrecision(parsed.data.startedAt) ||
          !hasPostgresTimestampPrecision(parsed.data.finishedAt)
        ) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const inserted = await queryRows(
            client,
            `/* reliable-event:insert-webhook-attempt */
             insert into public.webhook_processing_attempts (
               id, schema_version, webhook_inbox_id, attempt_number, outcome,
               error_code, started_at, finished_at
             ) values (
               $1::uuid, 1, $2::uuid, $3, $4, $5, $6::timestamptz,
               $7::timestamptz
             ) on conflict do nothing
             returning id::text as id`,
            [
              parsed.data.processingAttemptId,
              parsed.data.webhookInboxId,
              parsed.data.attemptNumber,
              parsed.data.outcome,
              optionalErrorCode(parsed.data),
              parsed.data.startedAt,
              parsed.data.finishedAt,
            ],
          );
          if (inserted.length === 1) {
            exactlyOneId(inserted, parsed.data.processingAttemptId);
            return webhookAttemptResponse(parsed.data, "RECORDED");
          }
          if (inserted.length !== 0) {
            throw failure("INTEGRITY_VIOLATION");
          }
          const existing = await queryRows(
            client,
            `/* reliable-event:load-webhook-attempt */
             select id::text as id,
                    webhook_inbox_id::text as webhook_inbox_id,
                    attempt_number::text as attempt_number,
                    outcome, error_code, started_at, finished_at,
                    started_at = $4::timestamptz as started_at_matches,
                    finished_at = $5::timestamptz as finished_at_matches
               from public.webhook_processing_attempts
              where id = $1::uuid
                 or (webhook_inbox_id = $2::uuid and attempt_number = $3)
              for update`,
            [
              parsed.data.processingAttemptId,
              parsed.data.webhookInboxId,
              parsed.data.attemptNumber,
              parsed.data.startedAt,
              parsed.data.finishedAt,
            ],
          );
          if (
            existing.length !== 1 ||
            existing[0] === undefined ||
            !attemptedRecordMatches(
              existing[0],
              parsed.data,
              "webhook_inbox_id",
              parsed.data.webhookInboxId,
            )
          ) {
            throw failure("IDEMPOTENCY_CONFLICT");
          }
          return webhookAttemptResponse(
            parsed.data,
            "REPLAY",
            requiredString(existing[0], "id"),
          );
        });
      },
      async recordEffect(command): Promise<RecordWebhookEffectResponse> {
        const parsed = recordWebhookEffectCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const inserted = await queryRows(
            client,
            `/* reliable-event:insert-webhook-effect */
             insert into public.webhook_effects (
               id, schema_version, webhook_inbox_id, effect_key, subject_id
             ) values ($1::uuid, 1, $2::uuid, $3, $4::uuid)
             on conflict do nothing
             returning id::text as id`,
            [
              parsed.data.webhookEffectId,
              parsed.data.webhookInboxId,
              parsed.data.effectKey,
              parsed.data.subjectId,
            ],
          );
          let decision: "RECORDED" | "REPLAY";
          if (inserted.length === 1) {
            exactlyOneId(inserted, parsed.data.webhookEffectId);
            decision = "RECORDED";
          } else if (inserted.length === 0) {
            const existing = await queryRows(
              client,
              `/* reliable-event:load-webhook-effect */
               select id::text as id
                 from public.webhook_effects
                where webhook_inbox_id = $1::uuid
                  and effect_key = $2
                  and subject_id = $3::uuid
                for update`,
              [
                parsed.data.webhookInboxId,
                parsed.data.effectKey,
                parsed.data.subjectId,
              ],
            );
            if (
              existing.length !== 1 ||
              existing[0] === undefined ||
              typeof existing[0]["id"] !== "string"
            ) {
              throw failure("IDEMPOTENCY_CONFLICT");
            }
            decision = "REPLAY";
          } else {
            throw failure("INTEGRITY_VIOLATION");
          }
          return recordWebhookEffectResponseSchema.parse({
            schemaVersion: 1,
            operation: "RECORD_WEBHOOK_EFFECT",
            outcome: "SUCCESS",
            value: {
              decision,
              webhookInboxId: parsed.data.webhookInboxId,
              effectKey: parsed.data.effectKey,
              subjectId: parsed.data.subjectId,
            },
          });
        });
      },
    },
    outboxDispatch: {
      async listReady(command): Promise<ListReadyOutboxEventsResponse> {
        const parsed = listReadyOutboxEventsCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const rows = await queryRows(
            client,
            `/* reliable-event:list-ready-outbox */
             select event.id::text as outbox_event_id,
                    event.correlation_id::text as correlation_id
               from public.outbox_events event
              where event.available_at <= $2::timestamptz
                and not exists (
                  select 1 from public.outbox_dispatch_attempts attempt
                   where attempt.outbox_event_id = event.id
                     and attempt.consumer_key = $1
                     and attempt.outcome in ('SUCCEEDED', 'DEAD_LETTER')
                )
              order by event.available_at, event.id
              limit $3
              for update of event skip locked`,
            [
              parsed.data.consumerKey,
              parsed.data.availableAtOrBefore,
              parsed.data.limit,
            ],
          );
          const response = listReadyOutboxEventsResponseSchema.safeParse({
            schemaVersion: 1,
            operation: "LIST_READY_OUTBOX_EVENTS",
            outcome: "SUCCESS",
            value: {
              jobs: rows.map((row) => ({
                schemaVersion: 1,
                jobType: "DISPATCH_OUTBOX_EVENT",
                outboxEventId: requiredString(row, "outbox_event_id"),
                consumerKey: parsed.data.consumerKey,
                correlationId: requiredString(row, "correlation_id"),
                propagation: parsed.data.propagation,
              })),
            },
          });
          if (!response.success) {
            throw failure("INTEGRITY_VIOLATION");
          }
          return response.data;
        });
      },
      async loadContext(command): Promise<LoadOutboxDispatchContextResponse> {
        const parsed =
          loadOutboxDispatchContextCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const rows = await queryRows(
            client,
            `/* reliable-event:load-outbox-context */
             select event.id::text as outbox_event_id,
                    event.event_type,
                    event.aggregate_id::text as aggregate_id,
                    event.aggregate_version::text as aggregate_version,
                    event.primary_subject_id::text as primary_subject_id,
                    event.secondary_subject_id::text as secondary_subject_id,
                    event.locale::text as locale,
                    event.market::text as market,
                    event.currency::text as currency,
                    event.correlation_id::text as correlation_id,
                    event.causation_id::text as causation_id,
                    event.request_id::text as request_id,
                    event.trace_id,
                    to_char(
                      event.occurred_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) as occurred_at,
                    event.payload_status,
                    exists (
                      select 1 from public.outbox_dispatch_attempts attempt
                       where attempt.outbox_event_id = event.id
                         and attempt.consumer_key = $2
                         and attempt.outcome = 'SUCCEEDED'
                    ) as already_dispatched,
                    coalesce((
                      select max(attempt.attempt_number) + 1
                        from public.outbox_dispatch_attempts attempt
                       where attempt.outbox_event_id = event.id
                         and attempt.consumer_key = $2
                    ), 1)::text as next_attempt_number
               from public.outbox_events event
              where event.id = $1::uuid`,
            [parsed.data.outboxEventId, parsed.data.consumerKey],
          );
          if (rows.length === 0) {
            throw failure("NOT_FOUND");
          }
          if (rows.length !== 1 || rows[0] === undefined) {
            throw failure("INTEGRITY_VIOLATION");
          }
          const row = rows[0];
          if (requiredBoolean(row, "already_dispatched")) {
            return loadOutboxDispatchContextResponseSchema.parse({
              schemaVersion: 1,
              operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
              outcome: "SUCCESS",
              value: {
                decision: "ALREADY_DISPATCHED",
                outboxEventId: requiredString(row, "outbox_event_id"),
                consumerKey: parsed.data.consumerKey,
              },
            });
          }
          const secondarySubjectId = nullableString(
            row,
            "secondary_subject_id",
          );
          const market = nullableString(row, "market");
          const currency = nullableString(row, "currency");
          const response = loadOutboxDispatchContextResponseSchema.safeParse({
            schemaVersion: 1,
            operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
            outcome: "SUCCESS",
            value: {
              decision: "READY",
              outboxEventId: requiredString(row, "outbox_event_id"),
              consumerKey: parsed.data.consumerKey,
              event: outboxEventFromRow(row),
              aggregateVersion: positiveInteger(row, "aggregate_version"),
              primarySubjectId: requiredString(row, "primary_subject_id"),
              ...(secondarySubjectId === null ? {} : { secondarySubjectId }),
              ...(market === null ? {} : { market }),
              ...(currency === null ? {} : { currency }),
              nextAttemptNumber: positiveInteger(row, "next_attempt_number"),
            },
          });
          if (!response.success) {
            throw failure("INTEGRITY_VIOLATION");
          }
          return response.data;
        });
      },
      async recordAttempt(
        command,
      ): Promise<RecordOutboxDispatchAttemptResponse> {
        const parsed =
          recordOutboxDispatchAttemptCommandSchema.safeParse(command);
        if (
          !parsed.success ||
          !hasPostgresTimestampPrecision(parsed.data.startedAt) ||
          !hasPostgresTimestampPrecision(parsed.data.finishedAt)
        ) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const inserted = await queryRows(
            client,
            `/* reliable-event:insert-outbox-attempt */
             insert into public.outbox_dispatch_attempts (
               id, schema_version, outbox_event_id, consumer_key,
               attempt_number, outcome, error_code, started_at, finished_at
             ) values (
               $1::uuid, 1, $2::uuid, $3, $4, $5, $6,
               $7::timestamptz, $8::timestamptz
             ) on conflict do nothing
             returning id::text as id`,
            [
              parsed.data.dispatchAttemptId,
              parsed.data.outboxEventId,
              parsed.data.consumerKey,
              parsed.data.attemptNumber,
              parsed.data.outcome,
              optionalErrorCode(parsed.data),
              parsed.data.startedAt,
              parsed.data.finishedAt,
            ],
          );
          if (inserted.length === 1) {
            exactlyOneId(inserted, parsed.data.dispatchAttemptId);
            return outboxAttemptResponse(parsed.data, "RECORDED");
          }
          if (inserted.length !== 0) {
            throw failure("INTEGRITY_VIOLATION");
          }
          const existing = await queryRows(
            client,
            `/* reliable-event:load-outbox-attempt */
             select id::text as id,
                    outbox_event_id::text as outbox_event_id,
                    consumer_key,
                    attempt_number::text as attempt_number,
                    outcome, error_code, started_at, finished_at,
                    started_at = $5::timestamptz as started_at_matches,
                    finished_at = $6::timestamptz as finished_at_matches
               from public.outbox_dispatch_attempts
              where id = $1::uuid
                 or (outbox_event_id = $2::uuid and consumer_key = $3
                     and attempt_number = $4)
              for update`,
            [
              parsed.data.dispatchAttemptId,
              parsed.data.outboxEventId,
              parsed.data.consumerKey,
              parsed.data.attemptNumber,
              parsed.data.startedAt,
              parsed.data.finishedAt,
            ],
          );
          if (
            existing.length !== 1 ||
            existing[0] === undefined ||
            !attemptedRecordMatches(
              existing[0],
              parsed.data,
              "outbox_event_id",
              parsed.data.outboxEventId,
              parsed.data.consumerKey,
            )
          ) {
            throw failure("IDEMPOTENCY_CONFLICT");
          }
          return outboxAttemptResponse(
            parsed.data,
            "REPLAY",
            requiredString(existing[0], "id"),
          );
        });
      },
      async recordEffect(command): Promise<RecordOutboxEffectResponse> {
        const parsed = recordOutboxEffectCommandSchema.safeParse(command);
        if (!parsed.success) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const inserted = await queryRows(
            client,
            `/* reliable-event:insert-outbox-effect */
             insert into public.outbox_effect_receipts (
               id, schema_version, outbox_event_id, consumer_key, effect_key,
               subject_id
             ) values ($1::uuid, 1, $2::uuid, $3, $4, $5::uuid)
             on conflict do nothing
             returning id::text as id`,
            [
              parsed.data.outboxEffectId,
              parsed.data.outboxEventId,
              parsed.data.consumerKey,
              parsed.data.effectKey,
              parsed.data.subjectId,
            ],
          );
          let decision: "RECORDED" | "REPLAY";
          if (inserted.length === 1) {
            exactlyOneId(inserted, parsed.data.outboxEffectId);
            decision = "RECORDED";
          } else if (inserted.length === 0) {
            const existing = await queryRows(
              client,
              `/* reliable-event:load-outbox-effect */
               select id::text as id
                 from public.outbox_effect_receipts
                where outbox_event_id = $1::uuid
                  and consumer_key = $2
                  and effect_key = $3
                  and subject_id = $4::uuid
                for update`,
              [
                parsed.data.outboxEventId,
                parsed.data.consumerKey,
                parsed.data.effectKey,
                parsed.data.subjectId,
              ],
            );
            if (
              existing.length !== 1 ||
              existing[0] === undefined ||
              typeof existing[0]["id"] !== "string"
            ) {
              throw failure("IDEMPOTENCY_CONFLICT");
            }
            decision = "REPLAY";
          } else {
            throw failure("INTEGRITY_VIOLATION");
          }
          return recordOutboxEffectResponseSchema.parse({
            schemaVersion: 1,
            operation: "RECORD_OUTBOX_EFFECT",
            outcome: "SUCCESS",
            value: {
              decision,
              outboxEventId: parsed.data.outboxEventId,
              consumerKey: parsed.data.consumerKey,
              effectKey: parsed.data.effectKey,
              subjectId: parsed.data.subjectId,
            },
          });
        });
      },
    },
    webhookPayloadRetention: {
      async purgeExpired(
        command,
      ): Promise<PurgeExpiredWebhookPayloadsResponse> {
        const parsed =
          purgeExpiredWebhookPayloadsCommandSchema.safeParse(command);
        if (
          !parsed.success ||
          Date.parse(parsed.data.expiredAtOrBefore) >
            Date.parse(parsed.data.purgedAt)
        ) {
          return rejectTrackedOperation(transactionScope, "INVALID_COMMAND");
        }
        return runQueuedOperation(client, transactionScope, async () => {
          const rows = await queryRows(
            client,
            `/* reliable-event:purge-webhook-payloads */
             with candidates as (
               select id
                 from public.webhook_payloads
                where status = 'RETAINED'
                  and retention_expires_at <= least(
                    $1::timestamptz,
                    transaction_timestamp()
                  )
                order by retention_expires_at, id
                limit $2
                for update skip locked
             )
             update public.webhook_payloads payload
                set status = 'PURGED',
                    payload_ciphertext = null,
                    encrypted_data_key = null,
                    encryption_key_version = null,
                    purged_at = transaction_timestamp()
               from candidates
              where payload.id = candidates.id
             returning payload.id::text as id`,
            [parsed.data.expiredAtOrBefore, parsed.data.limit],
          );
          const purgedPayloadIds = rows.map((row) => requiredString(row, "id"));
          const response = purgeExpiredWebhookPayloadsResponseSchema.safeParse({
            schemaVersion: 1,
            operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
            outcome: "SUCCESS",
            value: {
              purgedPayloadIds,
              purgedCount: purgedPayloadIds.length,
            },
          });
          if (!response.success) {
            throw failure("INTEGRITY_VIOLATION");
          }
          return response.data;
        });
      },
    },
  };
}
