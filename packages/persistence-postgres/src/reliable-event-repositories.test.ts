import { expect, test, vi } from "vitest";

import {
  listReadyOutboxEventsCommandSchema,
  loadOutboxDispatchContextCommandSchema,
  loadPaymentWebhookEndpointCommandSchema,
  loadWebhookProcessingContextCommandSchema,
  PersistenceTransactionFailureError,
  purgeExpiredWebhookPayloadsCommandSchema,
  recordOutboxDispatchAttemptCommandSchema,
  recordOutboxEffectCommandSchema,
  recordVerifiedWebhookReceiptCommandSchema,
  recordWebhookEffectCommandSchema,
  recordWebhookProcessingAttemptCommandSchema,
  type ReliableEventTransactionRepositories,
} from "@fan-support/persistence-port";

import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

type ReliableEventRepositorySet = Omit<
  ReliableEventTransactionRepositories,
  "outbox"
>;
type Factory = (
  client: TransactionClient,
  dependencies: Readonly<{
    transactionScope: TransactionScopeControl;
    publishWebhookInbox: (
      client: TransactionClient,
      job: unknown,
    ) => Promise<void>;
  }>,
) => ReliableEventRepositorySet;

type QueryStep = Readonly<{
  marker: string;
  rows?: readonly Readonly<Record<string, unknown>>[];
  error?: unknown;
}>;

class ScriptedClient implements TransactionClient {
  public readonly calls: Array<
    Readonly<{ text: string; values: readonly unknown[] }>
  > = [];

  public constructor(private readonly steps: QueryStep[]) {}

  public async query(text: string, values: unknown[] = []): Promise<unknown> {
    this.calls.push({ text, values: [...values] });
    if (
      /^(?:savepoint|rollback to savepoint|release savepoint)\b/iu.test(
        text.trim(),
      )
    ) {
      return { rows: [] };
    }
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("unexpected data query");
    }
    expect(text).toContain(step.marker);
    if (step.error !== undefined) {
      throw step.error;
    }
    return { rows: step.rows ?? [] };
  }

  public release(): void {}

  public expectComplete(): void {
    expect(this.steps).toEqual([]);
  }

  public dataCalls(): readonly Readonly<{
    text: string;
    values: readonly unknown[];
  }>[] {
    return this.calls.filter(
      (call) =>
        !/^(?:savepoint|rollback to savepoint|release savepoint)\b/iu.test(
          call.text.trim(),
        ),
    );
  }
}

async function loadFactory(): Promise<Factory> {
  const modulePath = "./reliable-event-repositories.js";
  const module = (await import(modulePath)) as Readonly<{
    createReliableEventRepositories: Factory;
  }>;
  return module.createReliableEventRepositories;
}

function createScope(): TransactionScopeControl {
  return {
    markRollbackOnly: vi.fn(),
    trackOperation: async <Result>(operation: () => Promise<Result>) =>
      operation(),
  };
}

const IDS = {
  endpoint: "40000000-0000-4000-8000-000000000001",
  account: "40000000-0000-4000-8000-000000000002",
  payload: "40000000-0000-4000-8000-000000000003",
  inbox: "40000000-0000-4000-8000-000000000004",
  providerEvent: "40000000-0000-4000-8000-000000000005",
  association: "40000000-0000-4000-8000-000000000006",
  paymentAttempt: "40000000-0000-4000-8000-000000000007",
  order: "40000000-0000-4000-8000-000000000008",
  processingAttempt: "40000000-0000-4000-8000-000000000009",
  webhookEffect: "40000000-0000-4000-8000-000000000010",
  outboxEvent: "40000000-0000-4000-8000-000000000011",
  dispatchAttempt: "40000000-0000-4000-8000-000000000012",
  outboxEffect: "40000000-0000-4000-8000-000000000013",
  subject: "40000000-0000-4000-8000-000000000014",
  request: "40000000-0000-4000-8000-000000000015",
  correlation: "40000000-0000-4000-8000-000000000016",
  alternate: "40000000-0000-4000-8000-000000000017",
} as const;
const NOW = "2026-09-04T00:00:00.000Z";
const PROPAGATION = {
  schemaVersion: 1,
  requestId: IDS.request,
  traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
} as const;
const ENDPOINT = {
  schemaVersion: 1,
  endpointId: IDS.endpoint,
  providerAccountId: IDS.account,
  environment: "TEST",
  adapterKey: "fake_psp",
  verificationKeyReferenceHash: "a".repeat(64),
  lifecycle: {
    status: "ACTIVE",
    activeFrom: "2026-09-03T00:00:00.000Z",
  },
} as const;
const CANDIDATE = {
  schemaVersion: 1,
  providerEventId: "fake-event/payment/succeeded/1",
  occurredAt: "2026-09-03T23:59:59.000Z",
  externalReference: "fake-payment/1",
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  amountMinor: 2_500,
  currency: "USD",
  transaction: {
    type: "CAPTURE",
    providerReference: "fake-capture/1",
  },
} as const;
const JOB = {
  schemaVersion: 1,
  jobType: "PROCESS_WEBHOOK_INBOX",
  webhookInboxId: IDS.inbox,
  correlationId: IDS.correlation,
  propagation: PROPAGATION,
} as const;
const RECEIPT = recordVerifiedWebhookReceiptCommandSchema.parse({
  schemaVersion: 1,
  operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
  endpoint: ENDPOINT,
  webhookPayload: {
    schemaVersion: 1,
    webhookPayloadId: IDS.payload,
    ciphertext: `enc:v1:${"A".repeat(32)}`,
    encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
    encryptionKeyVersion: "webhook-2026-09",
    algorithm: "AES_256_GCM",
    payloadSha256: "b".repeat(64),
    retentionExpiresAt: "2026-09-11T00:00:00.000Z",
  },
  webhookInboxId: IDS.inbox,
  providerEventRowId: IDS.providerEvent,
  association: {
    schemaVersion: 1,
    associationId: IDS.association,
    status: "UNMATCHED",
    reasonCode: "PAYMENT_ATTEMPT_ASSOCIATION_DEFERRED",
  },
  signatureTimestamp: NOW,
  receivedAt: NOW,
  candidate: CANDIDATE,
  job: JOB,
});

const ENDPOINT_ROW = {
  endpoint_id: IDS.endpoint,
  provider_account_id: IDS.account,
  environment: "TEST",
  adapter_key: "fake_psp",
  verification_key_reference_hash: "a".repeat(64),
  status: "ACTIVE",
  active_from: "2026-09-03T00:00:00.000Z",
  overlap_started_at: null,
  retired_at: null,
} as const;

function semanticEventRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    webhook_inbox_id: IDS.inbox,
    provider_event_row_id: IDS.providerEvent,
    provider_account_id: IDS.account,
    environment: "TEST",
    provider_event_reference: CANDIDATE.providerEventId,
    event_type: "PAYMENT_STATUS",
    normalized_status: "SUCCEEDED",
    external_payment_reference: CANDIDATE.externalReference,
    provider_refund_reference: null,
    provider_dispute_reference: null,
    provider_transaction_type: "CAPTURE",
    provider_transaction_reference: CANDIDATE.transaction.providerReference,
    amount_minor: "2500",
    currency: "USD",
    occurred_at: CANDIDATE.occurredAt,
    association_status: "MATCHED",
    payment_attempt_id: IDS.paymentAttempt,
    association_reason_code: "PAYMENT_ATTEMPT_MATCHED",
    already_processed: false,
    next_attempt_number: "1",
    ...overrides,
  };
}

function createRepositories(
  client: ScriptedClient,
  publishWebhookInbox: (
    client: TransactionClient,
    job: unknown,
  ) => Promise<void> = vi.fn<
    (client: TransactionClient, job: unknown) => Promise<void>
  >(async () => undefined),
): Promise<
  Readonly<{
    repositories: ReliableEventRepositorySet;
    publisher: typeof publishWebhookInbox;
  }>
> {
  return loadFactory().then((factory) => ({
    repositories: factory(client, {
      transactionScope: createScope(),
      publishWebhookInbox,
    }),
    publisher: publishWebhookInbox,
  }));
}

test("loads a secret-free eligible webhook endpoint", async () => {
  const client = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
  ]);
  const { repositories } = await createRepositories(client);
  const response = await repositories.paymentWebhookEndpoints.load(
    loadPaymentWebhookEndpointCommandSchema.parse({
      schemaVersion: 1,
      operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
      endpointId: IDS.endpoint,
      receivedAt: NOW,
    }),
  );

  expect(response).toEqual({
    schemaVersion: 1,
    operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
    outcome: "SUCCESS",
    value: { decision: "ELIGIBLE", endpoint: ENDPOINT },
  });
  expect(JSON.stringify(response)).not.toMatch(/secret|credential|raw/iu);
  expect(client.dataCalls()[0]?.values).toEqual([IDS.endpoint, NOW]);
  client.expectComplete();
});

test("writes and publishes a new receipt atomically on the same client", async () => {
  const client = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    { marker: "reliable-event:load-provider-event", rows: [] },
    {
      marker: "reliable-event:insert-webhook-payload",
      rows: [{ id: IDS.payload }],
    },
    {
      marker: "reliable-event:insert-webhook-inbox",
      rows: [{ id: IDS.inbox }],
    },
    {
      marker: "reliable-event:insert-provider-event",
      rows: [{ id: IDS.providerEvent }],
    },
    {
      marker: "reliable-event:insert-provider-association",
      rows: [{ id: IDS.association }],
    },
  ]);
  const publishOrder: number[] = [];
  const publishWebhookInbox = vi.fn(
    async (publisherClient: TransactionClient) => {
      expect(publisherClient).toBe(client);
      publishOrder.push(client.dataCalls().length);
    },
  );
  const { repositories, publisher } = await createRepositories(
    client,
    publishWebhookInbox,
  );

  await expect(
    repositories.verifiedWebhookReceipts.record(RECEIPT),
  ).resolves.toEqual({
    schemaVersion: 1,
    operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    outcome: "SUCCESS",
    value: {
      decision: "NEW",
      webhookInboxId: IDS.inbox,
      providerEventRowId: IDS.providerEvent,
      jobEnqueued: true,
    },
  });
  expect(publisher).toHaveBeenCalledWith(client, JOB);
  expect(publishOrder).toEqual([6]);
  const inboxInsert = client
    .dataCalls()
    .find((call) => call.text.includes("reliable-event:insert-webhook-inbox"));
  expect(inboxInsert?.text).toMatch(
    /signature_timestamp, received_at[\s\S]*\$9::timestamptz, transaction_timestamp\(\)/iu,
  );
  const providerEventInsert = client
    .dataCalls()
    .find((call) => call.text.includes("reliable-event:insert-provider-event"));
  expect(providerEventInsert?.text).toMatch(
    /\$15::timestamptz\s+where \$15::timestamptz <= transaction_timestamp\(\)/iu,
  );
  expect(client.dataCalls()[0]?.text).toMatch(
    /for share of endpoint, account/iu,
  );
  expect(client.dataCalls()[0]?.text).not.toMatch(/for key share/iu);
  for (const call of client.dataCalls()) {
    expect(call.text).not.toContain(IDS.endpoint);
    expect(call.text).not.toContain(CANDIDATE.providerEventId);
    expect(call.text).not.toMatch(
      /verification_secret_ref|credential_secret_ref/iu,
    );
  }
  client.expectComplete();
});

test("replays equal provider semantics despite a different raw digest and conflicts on changed semantics", async () => {
  const replayClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    {
      marker: "reliable-event:load-provider-event",
      rows: [semanticEventRow()],
    },
  ]);
  const replayPublisher = vi.fn(async () => undefined);
  const { repositories: replayRepositories } = await createRepositories(
    replayClient,
    replayPublisher,
  );
  const replayCommand = recordVerifiedWebhookReceiptCommandSchema.parse({
    ...RECEIPT,
    webhookPayload: {
      ...RECEIPT.webhookPayload,
      payloadSha256: "c".repeat(64),
    },
  });
  await expect(
    replayRepositories.verifiedWebhookReceipts.record(replayCommand),
  ).resolves.toMatchObject({ value: { decision: "REPLAY" } });
  expect(replayPublisher).not.toHaveBeenCalled();
  replayClient.expectComplete();

  const zeroAmountCommand = recordVerifiedWebhookReceiptCommandSchema.parse({
    ...RECEIPT,
    candidate: { ...RECEIPT.candidate, amountMinor: 0 },
  });
  const zeroAmountClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    {
      marker: "reliable-event:load-provider-event",
      rows: [semanticEventRow({ amount_minor: "0" })],
    },
  ]);
  const { repositories: zeroAmountRepositories } =
    await createRepositories(zeroAmountClient);
  await expect(
    zeroAmountRepositories.verifiedWebhookReceipts.record(zeroAmountCommand),
  ).resolves.toMatchObject({ value: { decision: "REPLAY" } });
  zeroAmountClient.expectComplete();

  const conflictClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    {
      marker: "reliable-event:load-provider-event",
      rows: [semanticEventRow({ normalized_status: "FAILED" })],
    },
  ]);
  const conflictPublisher = vi.fn(async () => undefined);
  const { repositories: conflictRepositories } = await createRepositories(
    conflictClient,
    conflictPublisher,
  );
  await expect(
    conflictRepositories.verifiedWebhookReceipts.record(RECEIPT),
  ).resolves.toEqual({
    schemaVersion: 1,
    operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    outcome: "SUCCESS",
    value: {
      decision: "CONFLICT",
      conflictCode: "PROVIDER_EVENT_IDENTITY_MISMATCH",
    },
  });
  expect(conflictPublisher).not.toHaveBeenCalled();
  conflictClient.expectComplete();

  const precisionConflictClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    {
      marker: "reliable-event:load-provider-event",
      rows: [
        semanticEventRow({
          occurred_at: "2026-09-03T23:59:59.000001Z",
          occurred_at_matches: false,
        }),
      ],
    },
  ]);
  const { repositories: precisionRepositories } = await createRepositories(
    precisionConflictClient,
  );
  await expect(
    precisionRepositories.verifiedWebhookReceipts.record(
      recordVerifiedWebhookReceiptCommandSchema.parse({
        ...RECEIPT,
        candidate: {
          ...RECEIPT.candidate,
          occurredAt: "2026-09-03T23:59:59.000002Z",
        },
      }),
    ),
  ).resolves.toMatchObject({ value: { decision: "CONFLICT" } });
  precisionConflictClient.expectComplete();
});

test("fails closed when the receipt endpoint lifecycle differs below millisecond precision", async () => {
  const client = new ScriptedClient([
    {
      marker: "reliable-event:load-endpoint",
      rows: [
        {
          ...ENDPOINT_ROW,
          active_from: "2026-09-03T00:00:00.000001Z",
        },
      ],
    },
  ]);
  const { repositories, publisher } = await createRepositories(client);
  const mismatch = recordVerifiedWebhookReceiptCommandSchema.parse({
    ...RECEIPT,
    endpoint: {
      ...RECEIPT.endpoint,
      lifecycle: {
        status: "ACTIVE",
        activeFrom: "2026-09-03T00:00:00.000002Z",
      },
    },
  });

  const result = await repositories.verifiedWebhookReceipts
    .record(mismatch)
    .catch((error: unknown) => error);
  expect(result).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(result).toMatchObject({ code: "NOT_FOUND", recovery: "NONE" });
  expect(publisher).not.toHaveBeenCalled();
  client.expectComplete();
});

test("turns a concurrent identity collision into replay and rolls back a failed publish", async () => {
  const concurrentClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    { marker: "reliable-event:load-provider-event", rows: [] },
    {
      marker: "reliable-event:insert-webhook-payload",
      rows: [{ id: IDS.payload }],
    },
    {
      marker: "reliable-event:insert-webhook-inbox",
      error: { code: "23505" },
    },
    {
      marker: "reliable-event:load-provider-event",
      rows: [semanticEventRow()],
    },
  ]);
  const concurrentPublisher = vi.fn(async () => undefined);
  const { repositories: concurrentRepositories } = await createRepositories(
    concurrentClient,
    concurrentPublisher,
  );
  await expect(
    concurrentRepositories.verifiedWebhookReceipts.record(RECEIPT),
  ).resolves.toMatchObject({ value: { decision: "REPLAY" } });
  expect(concurrentPublisher).not.toHaveBeenCalled();
  expect(
    concurrentClient.calls.some((call) =>
      /^rollback to savepoint reliable_event_receipt_insert$/iu.test(call.text),
    ),
  ).toBe(true);
  concurrentClient.expectComplete();

  const publishFailureClient = new ScriptedClient([
    { marker: "reliable-event:load-endpoint", rows: [ENDPOINT_ROW] },
    { marker: "reliable-event:load-provider-event", rows: [] },
    {
      marker: "reliable-event:insert-webhook-payload",
      rows: [{ id: IDS.payload }],
    },
    {
      marker: "reliable-event:insert-webhook-inbox",
      rows: [{ id: IDS.inbox }],
    },
    {
      marker: "reliable-event:insert-provider-event",
      rows: [{ id: IDS.providerEvent }],
    },
    {
      marker: "reliable-event:insert-provider-association",
      rows: [{ id: IDS.association }],
    },
  ]);
  const { repositories: failingRepositories } = await createRepositories(
    publishFailureClient,
    vi.fn(async () => {
      throw new Error("queue implementation detail");
    }),
  );
  const failure = await failingRepositories.verifiedWebhookReceipts
    .record(RECEIPT)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({
    code: "UNEXPECTED_ADAPTER_FAILURE",
    recovery: "RETRY_SAME_COMMAND",
  });
  expect((failure as Error).message).not.toContain("queue implementation");
  expect(
    publishFailureClient.calls.some((call) =>
      /^rollback to savepoint reliable_event_operation_/iu.test(call.text),
    ),
  ).toBe(true);
  publishFailureClient.expectComplete();
});

test("loads webhook contexts and idempotently records attempts and effects", async () => {
  const readyClient = new ScriptedClient([
    {
      marker: "reliable-event:load-webhook-context",
      rows: [semanticEventRow()],
    },
  ]);
  const { repositories: readyRepositories } =
    await createRepositories(readyClient);
  const loadCommand = loadWebhookProcessingContextCommandSchema.parse({
    schemaVersion: 1,
    operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
    webhookInboxId: IDS.inbox,
  });
  await expect(
    readyRepositories.webhookProcessing.loadContext(loadCommand),
  ).resolves.toMatchObject({
    value: {
      decision: "READY",
      webhookInboxId: IDS.inbox,
      providerEventRowId: IDS.providerEvent,
      nextAttemptNumber: 1,
      event: {
        evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: IDS.inbox },
        association: {
          status: "MATCHED",
          paymentAttemptId: IDS.paymentAttempt,
        },
      },
    },
  });
  readyClient.expectComplete();

  const doneClient = new ScriptedClient([
    {
      marker: "reliable-event:load-webhook-context",
      rows: [semanticEventRow({ already_processed: true })],
    },
  ]);
  const { repositories: doneRepositories } =
    await createRepositories(doneClient);
  await expect(
    doneRepositories.webhookProcessing.loadContext(loadCommand),
  ).resolves.toMatchObject({ value: { decision: "ALREADY_PROCESSED" } });
  doneClient.expectComplete();

  const attempt = recordWebhookProcessingAttemptCommandSchema.parse({
    schemaVersion: 1,
    operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
    processingAttemptId: IDS.processingAttempt,
    webhookInboxId: IDS.inbox,
    attemptNumber: 1,
    outcome: "SUCCEEDED",
    startedAt: NOW,
    finishedAt: "2026-09-04T00:00:01.000Z",
  });
  const attemptClient = new ScriptedClient([
    {
      marker: "reliable-event:insert-webhook-attempt",
      rows: [{ id: IDS.processingAttempt }],
    },
  ]);
  const { repositories: attemptRepositories } =
    await createRepositories(attemptClient);
  await expect(
    attemptRepositories.webhookProcessing.recordAttempt(attempt),
  ).resolves.toMatchObject({ value: { decision: "RECORDED" } });
  attemptClient.expectComplete();

  const replayAttemptClient = new ScriptedClient([
    { marker: "reliable-event:insert-webhook-attempt", rows: [] },
    {
      marker: "reliable-event:load-webhook-attempt",
      rows: [
        {
          id: IDS.alternate,
          webhook_inbox_id: IDS.inbox,
          attempt_number: "1",
          outcome: "SUCCEEDED",
          error_code: null,
          started_at: NOW,
          finished_at: "2026-09-04T00:00:01.000Z",
        },
      ],
    },
  ]);
  const { repositories: replayAttemptRepositories } =
    await createRepositories(replayAttemptClient);
  await expect(
    replayAttemptRepositories.webhookProcessing.recordAttempt(attempt),
  ).resolves.toMatchObject({
    value: {
      decision: "REPLAY",
      processingAttemptId: IDS.alternate,
    },
  });
  replayAttemptClient.expectComplete();

  const conflictingAttemptClient = new ScriptedClient([
    { marker: "reliable-event:insert-webhook-attempt", rows: [] },
    {
      marker: "reliable-event:load-webhook-attempt",
      rows: [
        {
          id: IDS.alternate,
          webhook_inbox_id: IDS.inbox,
          attempt_number: "1",
          outcome: "SUCCEEDED",
          error_code: null,
          started_at: NOW,
          finished_at: "2026-09-04T00:00:01.000Z",
          started_at_matches: false,
          finished_at_matches: true,
        },
      ],
    },
  ]);
  const { repositories: conflictingAttemptRepositories } =
    await createRepositories(conflictingAttemptClient);
  const attemptConflict = await conflictingAttemptRepositories.webhookProcessing
    .recordAttempt(attempt)
    .catch((error: unknown) => error);
  expect(attemptConflict).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(attemptConflict).toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
    recovery: "NONE",
  });
  conflictingAttemptClient.expectComplete();

  const effectClient = new ScriptedClient([
    { marker: "reliable-event:insert-webhook-effect", rows: [] },
    {
      marker: "reliable-event:load-webhook-effect",
      rows: [{ id: IDS.alternate }],
    },
  ]);
  const { repositories: effectRepositories } =
    await createRepositories(effectClient);
  await expect(
    effectRepositories.webhookProcessing.recordEffect(
      recordWebhookEffectCommandSchema.parse({
        schemaVersion: 1,
        operation: "RECORD_WEBHOOK_EFFECT",
        webhookEffectId: IDS.webhookEffect,
        webhookInboxId: IDS.inbox,
        effectKey: "PAYMENT:SUCCEEDED",
        subjectId: IDS.paymentAttempt,
      }),
    ),
  ).resolves.toMatchObject({ value: { decision: "REPLAY" } });
  expect(effectClient.dataCalls()[1]?.values).toEqual([
    IDS.inbox,
    "PAYMENT:SUCCEEDED",
    IDS.paymentAttempt,
  ]);
  effectClient.expectComplete();
});

const OUTBOX_ROW = {
  outbox_event_id: IDS.outboxEvent,
  event_type: "PAYMENT_STATUS_CHANGED",
  aggregate_id: IDS.paymentAttempt,
  aggregate_version: "1",
  primary_subject_id: IDS.paymentAttempt,
  secondary_subject_id: IDS.order,
  locale: null,
  market: "AMERICAS",
  currency: "USD",
  correlation_id: IDS.correlation,
  causation_id: null,
  request_id: IDS.request,
  trace_id: "a".repeat(32),
  occurred_at: NOW,
  payload_status: "SUCCEEDED",
  next_attempt_number: "1",
  already_dispatched: false,
} as const;

test("lists ID-only outbox jobs and loads ready or already-dispatched contexts", async () => {
  const listClient = new ScriptedClient([
    {
      marker: "reliable-event:list-ready-outbox",
      rows: [OUTBOX_ROW],
    },
  ]);
  const { repositories: listRepositories } =
    await createRepositories(listClient);
  const listCommand = listReadyOutboxEventsCommandSchema.parse({
    schemaVersion: 1,
    operation: "LIST_READY_OUTBOX_EVENTS",
    consumerKey: "notification-provider",
    availableAtOrBefore: NOW,
    limit: 100,
    propagation: PROPAGATION,
  });
  const listed = await listRepositories.outboxDispatch.listReady(listCommand);
  expect(listed.value.jobs).toEqual([
    {
      schemaVersion: 1,
      jobType: "DISPATCH_OUTBOX_EVENT",
      outboxEventId: IDS.outboxEvent,
      consumerKey: "notification-provider",
      correlationId: IDS.correlation,
      propagation: PROPAGATION,
    },
  ]);
  expect(JSON.stringify(listed)).not.toMatch(
    /payload|status|market|currency/iu,
  );
  expect(listClient.dataCalls()[0]?.values).toEqual([
    "notification-provider",
    NOW,
    100,
  ]);
  expect(listClient.dataCalls()[0]?.text).toMatch(
    /attempt\.outcome\s+in\s*\('SUCCEEDED',\s*'DEAD_LETTER'\)/iu,
  );
  listClient.expectComplete();

  const contextCommand = loadOutboxDispatchContextCommandSchema.parse({
    schemaVersion: 1,
    operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
    outboxEventId: IDS.outboxEvent,
    consumerKey: "notification-provider",
  });
  const readyClient = new ScriptedClient([
    {
      marker: "reliable-event:load-outbox-context",
      rows: [OUTBOX_ROW],
    },
  ]);
  const { repositories: readyRepositories } =
    await createRepositories(readyClient);
  await expect(
    readyRepositories.outboxDispatch.loadContext(contextCommand),
  ).resolves.toMatchObject({
    value: {
      decision: "READY",
      outboxEventId: IDS.outboxEvent,
      nextAttemptNumber: 1,
      event: {
        eventId: IDS.outboxEvent,
        eventType: "PAYMENT_STATUS_CHANGED",
        payload: {
          paymentAttemptId: IDS.paymentAttempt,
          orderId: IDS.order,
          status: "SUCCEEDED",
        },
      },
    },
  });
  readyClient.expectComplete();

  const doneClient = new ScriptedClient([
    {
      marker: "reliable-event:load-outbox-context",
      rows: [{ ...OUTBOX_ROW, already_dispatched: true }],
    },
  ]);
  const { repositories: doneRepositories } =
    await createRepositories(doneClient);
  await expect(
    doneRepositories.outboxDispatch.loadContext(contextCommand),
  ).resolves.toEqual({
    schemaVersion: 1,
    operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
    outcome: "SUCCESS",
    value: {
      decision: "ALREADY_DISPATCHED",
      outboxEventId: IDS.outboxEvent,
      consumerKey: "notification-provider",
    },
  });
  doneClient.expectComplete();
});

test("idempotently records outbox attempts and effects and purges only ciphertext", async () => {
  const attemptClient = new ScriptedClient([
    {
      marker: "reliable-event:insert-outbox-attempt",
      rows: [{ id: IDS.dispatchAttempt }],
    },
  ]);
  const { repositories: attemptRepositories } =
    await createRepositories(attemptClient);
  await expect(
    attemptRepositories.outboxDispatch.recordAttempt(
      recordOutboxDispatchAttemptCommandSchema.parse({
        schemaVersion: 1,
        operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
        dispatchAttemptId: IDS.dispatchAttempt,
        outboxEventId: IDS.outboxEvent,
        consumerKey: "notification-provider",
        attemptNumber: 1,
        outcome: "SUCCEEDED",
        startedAt: NOW,
        finishedAt: "2026-09-04T00:00:01.000Z",
      }),
    ),
  ).resolves.toMatchObject({ value: { decision: "RECORDED" } });
  attemptClient.expectComplete();

  const replayAttemptClient = new ScriptedClient([
    { marker: "reliable-event:insert-outbox-attempt", rows: [] },
    {
      marker: "reliable-event:load-outbox-attempt",
      rows: [
        {
          id: IDS.alternate,
          outbox_event_id: IDS.outboxEvent,
          consumer_key: "notification-provider",
          attempt_number: "1",
          outcome: "SUCCEEDED",
          error_code: null,
          started_at: NOW,
          finished_at: "2026-09-04T00:00:01.000Z",
        },
      ],
    },
  ]);
  const { repositories: replayAttemptRepositories } =
    await createRepositories(replayAttemptClient);
  await expect(
    replayAttemptRepositories.outboxDispatch.recordAttempt(
      recordOutboxDispatchAttemptCommandSchema.parse({
        schemaVersion: 1,
        operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
        dispatchAttemptId: IDS.dispatchAttempt,
        outboxEventId: IDS.outboxEvent,
        consumerKey: "notification-provider",
        attemptNumber: 1,
        outcome: "SUCCEEDED",
        startedAt: NOW,
        finishedAt: "2026-09-04T00:00:01.000Z",
      }),
    ),
  ).resolves.toMatchObject({
    value: { decision: "REPLAY", dispatchAttemptId: IDS.alternate },
  });
  replayAttemptClient.expectComplete();

  const effectClient = new ScriptedClient([
    { marker: "reliable-event:insert-outbox-effect", rows: [] },
    {
      marker: "reliable-event:load-outbox-effect",
      rows: [{ id: IDS.alternate }],
    },
  ]);
  const { repositories: effectRepositories } =
    await createRepositories(effectClient);
  await expect(
    effectRepositories.outboxDispatch.recordEffect(
      recordOutboxEffectCommandSchema.parse({
        schemaVersion: 1,
        operation: "RECORD_OUTBOX_EFFECT",
        outboxEffectId: IDS.outboxEffect,
        outboxEventId: IDS.outboxEvent,
        consumerKey: "notification-provider",
        effectKey: "NOTIFICATION:SEND",
        subjectId: IDS.subject,
      }),
    ),
  ).resolves.toMatchObject({ value: { decision: "REPLAY" } });
  effectClient.expectComplete();

  const purgeClient = new ScriptedClient([
    {
      marker: "reliable-event:purge-webhook-payloads",
      rows: [{ id: IDS.payload }],
    },
  ]);
  const { repositories: purgeRepositories } =
    await createRepositories(purgeClient);
  const purged = await purgeRepositories.webhookPayloadRetention.purgeExpired(
    purgeExpiredWebhookPayloadsCommandSchema.parse({
      schemaVersion: 1,
      operation: "PURGE_EXPIRED_WEBHOOK_PAYLOADS",
      expiredAtOrBefore: NOW,
      purgedAt: NOW,
      limit: 100,
    }),
  );
  expect(purged.value).toEqual({
    purgedPayloadIds: [IDS.payload],
    purgedCount: 1,
  });
  expect(purgeClient.dataCalls()[0]?.text).toMatch(
    /payload_ciphertext\s*=\s*null/iu,
  );
  expect(purgeClient.dataCalls()[0]?.text).toMatch(
    /encrypted_data_key\s*=\s*null/iu,
  );
  expect(purgeClient.dataCalls()[0]?.text).toMatch(
    /encryption_key_version\s*=\s*null/iu,
  );
  expect(JSON.stringify(purged)).not.toMatch(/ciphertext|encrypted/iu);
  purgeClient.expectComplete();
});

test("rejects invalid commands before querying or publishing", async () => {
  const client = new ScriptedClient([]);
  const publisher = vi.fn(async () => undefined);
  const { repositories } = await createRepositories(client, publisher);
  const failure = await repositories.verifiedWebhookReceipts
    .record({ ...RECEIPT, rawBodyBase64: "e30" } as never)
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({ code: "INVALID_COMMAND", recovery: "NONE" });
  expect(client.calls).toEqual([]);
  expect(publisher).not.toHaveBeenCalled();

  const ledgerFailure = await repositories.verifiedWebhookReceipts
    .record({
      ...RECEIPT,
      association: {
        schemaVersion: 1,
        associationId: IDS.association,
        status: "MATCHED",
        paymentAttemptId: IDS.paymentAttempt,
        reasonCode: "PAYMENT_ATTEMPT_MATCHED",
      },
    } as never)
    .catch((error: unknown) => error);
  expect(ledgerFailure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(ledgerFailure).toMatchObject({
    code: "INVALID_COMMAND",
    recovery: "NONE",
  });
  expect(client.calls).toEqual([]);
  expect(publisher).not.toHaveBeenCalled();
});
