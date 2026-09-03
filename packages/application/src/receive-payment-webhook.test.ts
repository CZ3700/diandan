import { expect, test, vi } from "vitest";
import {
  keyManagementPortResponseSchema,
  paymentWebhookVerificationResponseSchema,
  type PaymentWebhookVerificationResponse,
} from "@fan-support/contracts";
import type {
  EncryptEnvelopeResponse,
  KeyManagementPort,
} from "@fan-support/key-management-port";
import type { PaymentWebhookVerifier } from "@fan-support/payment-port";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import { createReceivePaymentWebhook } from "./receive-payment-webhook.js";

const IDS = {
  endpoint: "20000000-0000-4000-8000-000000000001",
  providerAccount: "20000000-0000-4000-8000-000000000002",
  webhookPayload: "20000000-0000-4000-8000-000000000003",
  webhookInbox: "20000000-0000-4000-8000-000000000004",
  providerEvent: "20000000-0000-4000-8000-000000000005",
  association: "20000000-0000-4000-8000-000000000006",
  request: "20000000-0000-4000-8000-000000000007",
  correlation: "20000000-0000-4000-8000-000000000008",
} as const;

const NOW = "2026-09-04T00:00:00.000Z";
const RAW_BODY =
  "eyAiZXZlbnRfaWQiOiAiZmFrZS1ldmVudC9wYXltZW50L3N1Y2NlZWRlZC8xIiB9Cg";
const PROPAGATION = {
  schemaVersion: 1,
  requestId: IDS.request,
  traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
} as const;
const COMMAND = {
  schemaVersion: 1,
  operation: "RECEIVE_PAYMENT_WEBHOOK",
  endpointId: IDS.endpoint,
  rawBodyBase64: RAW_BODY,
  headers: {
    "x-fan-support-signature": `v1=${"c".repeat(64)}`,
    "x-fan-support-timestamp": "1788480000",
  },
  receivedAt: NOW,
  correlationId: IDS.correlation,
  propagation: PROPAGATION,
} as const;

const ENDPOINT = {
  schemaVersion: 1,
  endpointId: IDS.endpoint,
  providerAccountId: IDS.providerAccount,
  environment: "TEST",
  adapterKey: "fake_psp",
  verificationKeyReferenceHash: "d".repeat(64),
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

function success(operation: string, value: unknown) {
  return { schemaVersion: 1, operation, outcome: "SUCCESS", value } as const;
}

function createHarness(
  options: Readonly<{
    endpointDecision?: "ELIGIBLE" | "UNAVAILABLE";
    verificationOutcome?: "SUCCESS" | "INVALID_SIGNATURE";
    receiptDecision?: "NEW" | "REPLAY" | "CONFLICT";
  }> = {},
) {
  const loadEndpoint = vi.fn(async (command: unknown) => {
    void command;
    return success(
      "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
      options.endpointDecision === "UNAVAILABLE"
        ? { decision: "UNAVAILABLE" }
        : { decision: "ELIGIBLE", endpoint: ENDPOINT },
    );
  });
  const recordReceipt = vi.fn(async (command: unknown) => {
    void command;
    return success(
      "RECORD_VERIFIED_WEBHOOK_RECEIPT",
      options.receiptDecision === "CONFLICT"
        ? {
            decision: "CONFLICT",
            conflictCode: "PROVIDER_EVENT_IDENTITY_MISMATCH",
          }
        : {
            decision: options.receiptDecision ?? "NEW",
            webhookInboxId: IDS.webhookInbox,
            providerEventRowId: IDS.providerEvent,
            ...(options.receiptDecision === "REPLAY"
              ? {}
              : { jobEnqueued: true }),
          },
    );
  });
  const repositories = {
    paymentWebhookEndpoints: { load: loadEndpoint },
    verifiedWebhookReceipts: { record: recordReceipt },
    webhookProcessing: {},
    outbox: {},
    outboxDispatch: {},
    webhookPayloadRetention: {},
  };
  const runInReliableEventTransaction = vi.fn(
    async (transactionOptions: unknown, work: (value: unknown) => unknown) => {
      void transactionOptions;
      return work(repositories);
    },
  );
  const verifyPaymentWebhook = vi.fn(
    async (command: unknown): Promise<PaymentWebhookVerificationResponse> => {
      void command;
      return paymentWebhookVerificationResponseSchema.parse(
        options.verificationOutcome === "INVALID_SIGNATURE"
          ? {
              schemaVersion: 1,
              operation: "VERIFY_PAYMENT_WEBHOOK",
              outcome: "FAILURE",
              error: {
                schemaVersion: 1,
                code: "INVALID_SIGNATURE",
                recovery: "NONE",
              },
            }
          : success("VERIFY_PAYMENT_WEBHOOK", {
              endpointId: IDS.endpoint,
              providerAccountId: IDS.providerAccount,
              environment: "TEST",
              verificationKeyReferenceHash:
                ENDPOINT.verificationKeyReferenceHash,
              signatureTimestamp: NOW,
              candidate: CANDIDATE,
            }),
      );
    },
  );
  const verifierForEndpoint = vi.fn((): PaymentWebhookVerifier | undefined => ({
    verifyPaymentWebhook,
  }));
  const encryptEnvelope = vi.fn(
    async (command: unknown): Promise<EncryptEnvelopeResponse> => {
      void command;
      return keyManagementPortResponseSchema.parse({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        outcome: "SUCCESS",
        value: {
          ciphertext: `enc:v1:${"A".repeat(32)}`,
          encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
          keyVersion: "webhook-2026-09",
          algorithm: "AES_256_GCM",
        },
      }) as EncryptEnvelopeResponse;
    },
  );
  const generatedIds = [
    IDS.webhookPayload,
    IDS.webhookInbox,
    IDS.providerEvent,
    IDS.association,
  ];
  const receive = createReceivePaymentWebhook({
    transactionManager: {
      runInReliableEventTransaction,
    } as unknown as ReliableEventTransactionManager,
    verifierForEndpoint,
    keyManagement: { encryptEnvelope } as unknown as Pick<
      KeyManagementPort,
      "encryptEnvelope"
    >,
    createId: () => {
      const next = generatedIds.shift();
      if (next === undefined) {
        throw new Error("fixture id budget exhausted");
      }
      return next;
    },
    sha256Hex: async () => "e".repeat(64),
  });

  return {
    encryptEnvelope,
    loadEndpoint,
    receive,
    recordReceipt,
    repositories,
    runInReliableEventTransaction,
    verifierForEndpoint,
    verifyPaymentWebhook,
  };
}

test("verifies exact raw bytes before atomically recording encrypted evidence and an ID-only job", async () => {
  const harness = createHarness();

  await expect(harness.receive(COMMAND)).resolves.toMatchObject({
    schemaVersion: 1,
    operation: "RECEIVE_PAYMENT_WEBHOOK",
    outcome: "SUCCESS",
    value: {
      decision: "ACCEPTED_NEW",
      webhookInboxId: IDS.webhookInbox,
      providerEventRowId: IDS.providerEvent,
    },
  });

  expect(harness.verifyPaymentWebhook).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId: IDS.endpoint,
    providerAccountId: IDS.providerAccount,
    environment: "TEST",
    verificationKeyReferenceHash: ENDPOINT.verificationKeyReferenceHash,
    rawBodyBase64: RAW_BODY,
    headers: COMMAND.headers,
    receivedAt: NOW,
  });
  expect(harness.encryptEnvelope).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "ENCRYPT_ENVELOPE",
    purpose: "WEBHOOK_PAYLOAD",
    subjectId: IDS.webhookPayload,
    plaintextBase64: RAW_BODY,
  });

  const receiptCommand = harness.recordReceipt.mock.calls[0]?.[0];
  expect(receiptCommand).toMatchObject({
    schemaVersion: 1,
    operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
    endpoint: ENDPOINT,
    webhookPayload: {
      webhookPayloadId: IDS.webhookPayload,
      payloadSha256: "e".repeat(64),
      retentionExpiresAt: "2026-09-11T00:00:00.000Z",
    },
    webhookInboxId: IDS.webhookInbox,
    providerEventRowId: IDS.providerEvent,
    association: {
      associationId: IDS.association,
      status: "UNMATCHED",
    },
    candidate: CANDIDATE,
    job: {
      schemaVersion: 1,
      jobType: "PROCESS_WEBHOOK_INBOX",
      webhookInboxId: IDS.webhookInbox,
      correlationId: IDS.correlation,
      propagation: PROPAGATION,
    },
  });
  const persistedJson = JSON.stringify(receiptCommand);
  expect(persistedJson).not.toContain(RAW_BODY);
  expect(persistedJson).not.toContain("x-fan-support-signature");
  expect(persistedJson).not.toContain("verificationSecret");
});

test("rejects an invalid signature before encryption or any receipt write", async () => {
  const harness = createHarness({ verificationOutcome: "INVALID_SIGNATURE" });

  await expect(harness.receive(COMMAND)).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "INVALID_SIGNATURE", recovery: "NONE" },
  });
  expect(harness.loadEndpoint).toHaveBeenCalledTimes(1);
  expect(harness.encryptEnvelope).not.toHaveBeenCalled();
  expect(harness.recordReceipt).not.toHaveBeenCalled();
  expect(harness.runInReliableEventTransaction).toHaveBeenCalledTimes(1);
});

test("rejects malformed input and unavailable endpoints before invoking a verifier", async () => {
  const malformed = createHarness();
  await expect(
    malformed.receive({ ...COMMAND, rawBodyBase64: "%%%" }),
  ).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "INVALID_REQUEST", recovery: "NONE" },
  });
  expect(malformed.loadEndpoint).not.toHaveBeenCalled();

  const unavailable = createHarness({ endpointDecision: "UNAVAILABLE" });
  await expect(unavailable.receive(COMMAND)).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "ENDPOINT_UNAVAILABLE", recovery: "NONE" },
  });
  expect(unavailable.verifierForEndpoint).not.toHaveBeenCalled();
  expect(unavailable.encryptEnvelope).not.toHaveBeenCalled();
  expect(unavailable.recordReceipt).not.toHaveBeenCalled();
});

test("maps semantic replay to success and identity mismatch to a closed conflict", async () => {
  const replay = createHarness({ receiptDecision: "REPLAY" });
  await expect(replay.receive(COMMAND)).resolves.toMatchObject({
    outcome: "SUCCESS",
    value: { decision: "ACCEPTED_REPLAY" },
  });

  const conflict = createHarness({ receiptDecision: "CONFLICT" });
  await expect(conflict.receive(COMMAND)).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "IDEMPOTENCY_CONFLICT", recovery: "NONE" },
  });
});

test("fails closed when no deployed verifier is registered for the endpoint", async () => {
  const harness = createHarness();
  harness.verifierForEndpoint.mockReturnValueOnce(undefined);

  await expect(harness.receive(COMMAND)).resolves.toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  expect(harness.encryptEnvelope).not.toHaveBeenCalled();
  expect(harness.recordReceipt).not.toHaveBeenCalled();
});
