import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  keyManagementPortResponseSchema,
  paymentWebhookVerificationResponseSchema,
  receivePaymentWebhookCommandSchema,
} from "@fan-support/contracts";
import { expect, test, vi } from "vitest";

import { createApiReliableEventsComposition } from "./reliable-events-composition.js";

const DATABASE_PASSWORD_CANARY = "PRIVATE_DATABASE_PASSWORD_81247";
const DATABASE_URL = `postgresql://api-user:${DATABASE_PASSWORD_CANARY}@postgres:5432/fan_support`;
const NOW = "2026-09-04T03:00:00.000Z";
const ENDPOINT_ID = "10000000-0000-4000-8000-000000000001";
const PROVIDER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000002";
const WEBHOOK_INBOX_ID = "10000000-0000-4000-8000-000000000003";
const PROVIDER_EVENT_ROW_ID = "10000000-0000-4000-8000-000000000004";
const REQUEST_ID = "10000000-0000-4000-8000-000000000005";
const CORRELATION_ID = "10000000-0000-4000-8000-000000000006";

const endpoint = Object.freeze({
  schemaVersion: 1 as const,
  endpointId: ENDPOINT_ID,
  providerAccountId: PROVIDER_ACCOUNT_ID,
  environment: "TEST" as const,
  adapterKey: "fake_psp",
  verificationKeyReferenceHash: "a".repeat(64),
  lifecycle: Object.freeze({
    status: "ACTIVE" as const,
    activeFrom: "2026-09-03T00:00:00.000Z",
  }),
});

const command = receivePaymentWebhookCommandSchema.parse({
  schemaVersion: 1 as const,
  operation: "RECEIVE_PAYMENT_WEBHOOK" as const,
  endpointId: ENDPOINT_ID,
  rawBodyBase64: Buffer.from('{"event":"paid"}\n', "utf8").toString(
    "base64url",
  ),
  headers: Object.freeze({
    "x-fan-support-signature": `v1=${"b".repeat(64)}`,
    "x-fan-support-timestamp": "1788480000",
  }),
  receivedAt: NOW,
  correlationId: CORRELATION_ID,
  propagation: Object.freeze({
    schemaVersion: 1 as const,
    requestId: REQUEST_ID,
    traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-01`,
  }),
});

const quietLogger = Object.freeze({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

function success<const Operation extends string>(
  operation: Operation,
  value: unknown,
) {
  return Object.freeze({
    schemaVersion: 1 as const,
    operation,
    outcome: "SUCCESS" as const,
    value,
  });
}

function createRepositories() {
  return {
    paymentWebhookEndpoints: {
      load: vi.fn(async () =>
        success("LOAD_PAYMENT_WEBHOOK_ENDPOINT", {
          decision: "ELIGIBLE",
          endpoint,
        }),
      ),
    },
    verifiedWebhookReceipts: {
      record: vi.fn(async (command: unknown) => {
        void command;
        return success("RECORD_VERIFIED_WEBHOOK_RECEIPT", {
          decision: "NEW",
          webhookInboxId: WEBHOOK_INBOX_ID,
          providerEventRowId: PROVIDER_EVENT_ROW_ID,
          jobEnqueued: true,
        });
      }),
    },
    webhookProcessing: {},
    outbox: {},
    outboxDispatch: {},
    webhookPayloadRetention: {},
  };
}

function createHarness() {
  const repositories = createRepositories();
  const runInReliableEventTransaction = vi.fn(
    async (_options: unknown, work: (value: unknown) => Promise<unknown>) =>
      work(repositories),
  );
  const queue = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    publishWebhookInbox: vi.fn(async () => undefined),
  };
  const close = vi.fn(async () => undefined);
  const createQueue = vi.fn((options: unknown) => {
    void options;
    return queue;
  });
  const createPersistence = vi.fn((config: unknown, options: unknown) => {
    void config;
    void options;
    return {
      reliableEventTransactionManager: { runInReliableEventTransaction },
      close,
    };
  });

  return {
    close,
    createPersistence,
    createQueue,
    queue,
    repositories,
    runInReliableEventTransaction,
  };
}

test("wires PostgreSQL receipt persistence to a verified pg-boss publisher and owns both lifecycles", async () => {
  const harness = createHarness();
  const composition = createApiReliableEventsComposition(
    { FAN_SUPPORT_DATABASE_URL: DATABASE_URL },
    {
      logger: quietLogger,
      factories: {
        createQueue: harness.createQueue as never,
        createPersistence: harness.createPersistence as never,
      },
    },
  );

  expect(harness.createQueue).toHaveBeenCalledWith({
    schemaVersion: 1,
    connectionString: DATABASE_URL,
    schema: "pgboss",
    managementMode: "VERIFY",
    localConcurrency: 1,
    onInfrastructureNotice: expect.any(Function),
  });
  expect(harness.createPersistence).toHaveBeenCalledWith(
    {
      connectionString: DATABASE_URL,
      application_name: "fan-support-api",
    },
    {
      onInfrastructureFailure: expect.any(Function),
      publishWebhookInbox: harness.queue.publishWebhookInbox,
    },
  );

  await composition.reliableEventsRuntime.start();
  await composition.reliableEventsRuntime.start();
  expect(harness.queue.start).toHaveBeenCalledTimes(1);
  expect(harness.queue.start).toHaveBeenCalledWith();

  await composition.reliableEventsRuntime.stop();
  await composition.reliableEventsRuntime.stop();
  expect(harness.close).toHaveBeenCalledTimes(1);
  expect(harness.queue.stop).toHaveBeenCalledTimes(1);
});

test("normalizes infrastructure notices without logging the database URL", async () => {
  quietLogger.warn.mockClear();
  quietLogger.error.mockClear();
  const harness = createHarness();
  createApiReliableEventsComposition(
    { FAN_SUPPORT_DATABASE_URL: DATABASE_URL },
    {
      logger: quietLogger,
      factories: {
        createQueue: harness.createQueue as never,
        createPersistence: harness.createPersistence as never,
      },
    },
  );

  const queueOptions = harness.createQueue.mock.calls[0]?.[0] as
    | Readonly<{
        onInfrastructureNotice?: (
          notice: Readonly<{
            schemaVersion: 1;
            severity: "ERROR" | "WARNING";
            code: "QUEUE_ENGINE_ERROR" | "QUEUE_ENGINE_WARNING";
          }>,
        ) => void | Promise<void>;
      }>
    | undefined;
  const persistenceOptions = harness.createPersistence.mock.calls[0]?.[1] as
    | Readonly<{
        onInfrastructureFailure?: (
          failure: Readonly<{
            code: "TEMPORARY_UNAVAILABLE";
            recovery: "RETRY_SAME_COMMAND";
            retryAfterMs: number;
          }>,
        ) => void | Promise<void>;
      }>
    | undefined;
  await queueOptions?.onInfrastructureNotice?.({
    schemaVersion: 1,
    severity: "WARNING",
    code: "QUEUE_ENGINE_WARNING",
  });
  await persistenceOptions?.onInfrastructureFailure?.({
    code: "TEMPORARY_UNAVAILABLE",
    recovery: "RETRY_SAME_COMMAND",
    retryAfterMs: 250,
  });

  expect(quietLogger.warn).toHaveBeenCalledWith(
    "reliable_events.queue_notice",
    {
      errorCode: "QUEUE_ENGINE_WARNING",
      outcome: "failure",
    },
  );
  expect(quietLogger.error).toHaveBeenCalledWith(
    "reliable_events.persistence_failure",
    {
      errorCode: "TEMPORARY_UNAVAILABLE",
      outcome: "failure",
    },
  );
  expect(
    JSON.stringify([
      ...quietLogger.warn.mock.calls,
      ...quietLogger.error.mock.calls,
    ]),
  ).not.toContain(DATABASE_PASSWORD_CANARY);
});

test("fails closed when no production webhook verifier is registered", async () => {
  const harness = createHarness();
  const composition = createApiReliableEventsComposition(
    { FAN_SUPPORT_DATABASE_URL: DATABASE_URL },
    {
      logger: quietLogger,
      factories: {
        createQueue: harness.createQueue as never,
        createPersistence: harness.createPersistence as never,
      },
    },
  );

  await expect(
    composition.paymentWebhookRoute.receiver.receive(command),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  expect(
    harness.repositories.verifiedWebhookReceipts.record,
  ).not.toHaveBeenCalled();
});

test("fails closed when a verifier is injected without a production key manager", async () => {
  const harness = createHarness();
  const composition = createApiReliableEventsComposition(
    { FAN_SUPPORT_DATABASE_URL: DATABASE_URL },
    {
      logger: quietLogger,
      factories: {
        createQueue: harness.createQueue as never,
        createPersistence: harness.createPersistence as never,
      },
      verifierForEndpoint: () => ({
        verifyPaymentWebhook: async () =>
          paymentWebhookVerificationResponseSchema.parse({
            schemaVersion: 1,
            operation: "VERIFY_PAYMENT_WEBHOOK",
            outcome: "SUCCESS",
            value: {
              endpointId: ENDPOINT_ID,
              providerAccountId: PROVIDER_ACCOUNT_ID,
              environment: "TEST",
              verificationKeyReferenceHash:
                endpoint.verificationKeyReferenceHash,
              signatureTimestamp: NOW,
              candidate: {
                schemaVersion: 1,
                providerEventId: "fake-event/payment/succeeded/1",
                occurredAt: "2026-09-04T02:59:59.000Z",
                externalReference: "fake-payment/1",
                eventType: "PAYMENT_STATUS",
                status: "SUCCEEDED",
                amountMinor: 2500,
                currency: "USD",
              },
            },
          }),
      }),
    },
  );

  await expect(
    composition.paymentWebhookRoute.receiver.receive(command),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  expect(
    harness.repositories.verifiedWebhookReceipts.record,
  ).not.toHaveBeenCalled();
});

test("hashes the decoded raw bytes before persisting verified webhook evidence", async () => {
  const harness = createHarness();
  const generatedIds = [
    "20000000-0000-4000-8000-000000000001",
    WEBHOOK_INBOX_ID,
    PROVIDER_EVENT_ROW_ID,
    "20000000-0000-4000-8000-000000000004",
  ];
  const composition = createApiReliableEventsComposition(
    { FAN_SUPPORT_DATABASE_URL: DATABASE_URL },
    {
      logger: quietLogger,
      factories: {
        createQueue: harness.createQueue as never,
        createPersistence: harness.createPersistence as never,
      },
      createId: () => {
        const next = generatedIds.shift();
        if (next === undefined) {
          throw new Error("fixture ID budget exhausted");
        }
        return next;
      },
      verifierForEndpoint: () => ({
        verifyPaymentWebhook: async () =>
          paymentWebhookVerificationResponseSchema.parse({
            schemaVersion: 1,
            operation: "VERIFY_PAYMENT_WEBHOOK",
            outcome: "SUCCESS",
            value: {
              endpointId: ENDPOINT_ID,
              providerAccountId: PROVIDER_ACCOUNT_ID,
              environment: "TEST",
              verificationKeyReferenceHash:
                endpoint.verificationKeyReferenceHash,
              signatureTimestamp: NOW,
              candidate: {
                schemaVersion: 1,
                providerEventId: "fake-event/payment/succeeded/1",
                occurredAt: "2026-09-04T02:59:59.000Z",
                externalReference: "fake-payment/1",
                eventType: "PAYMENT_STATUS",
                status: "SUCCEEDED",
                amountMinor: 2500,
                currency: "USD",
              },
            },
          }),
      }),
      keyManagement: {
        encryptEnvelope: async () =>
          keyManagementPortResponseSchema.parse({
            schemaVersion: 1,
            operation: "ENCRYPT_ENVELOPE",
            outcome: "SUCCESS",
            value: {
              ciphertext: `enc:v1:${"E".repeat(32)}`,
              encryptedDataKey: `enc:v1:${"F".repeat(32)}`,
              keyVersion: "webhook-test-v1",
              algorithm: "AES_256_GCM",
            },
          }),
      } as never,
    },
  );

  await expect(
    composition.paymentWebhookRoute.receiver.receive(command),
  ).resolves.toMatchObject({ outcome: "SUCCESS" });
  const receipt = harness.repositories.verifiedWebhookReceipts.record.mock
    .calls[0]?.[0] as
    | Readonly<{
        webhookPayload?: Readonly<{ payloadSha256?: string }>;
      }>
    | undefined;
  const expectedHash = createHash("sha256")
    .update(Buffer.from(command.rawBodyBase64, "base64url"))
    .digest("hex");
  expect(receipt?.webhookPayload?.payloadSha256).toBe(expectedHash);
});
