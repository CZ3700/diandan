import {
  keyManagementPortResponseSchema,
  loadPaymentWebhookEndpointResponseSchema,
  paymentWebhookVerificationResponseMatchesCommand,
  paymentWebhookVerificationResponseSchema,
  receivePaymentWebhookCommandSchema,
  receivePaymentWebhookResponseSchema,
  recordVerifiedWebhookReceiptCommandSchema,
  recordVerifiedWebhookReceiptResponseSchema,
  type PaymentWebhookEndpointDescriptor,
  type ReceivePaymentWebhookResponse,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { PaymentWebhookVerifier } from "@fan-support/payment-port";
import {
  parsePersistenceTransactionFailure,
  type ReliableEventTransactionManager,
} from "@fan-support/persistence-port";

const WEBHOOK_PAYLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export type ReceivePaymentWebhookDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
  verifierForEndpoint(
    adapterKey: string,
    endpointId: string,
  ): PaymentWebhookVerifier | undefined;
  keyManagement: Pick<KeyManagementPort, "encryptEnvelope">;
  createId(): string;
  sha256Hex(rawBodyBase64: string): Promise<string>;
}>;

function response(value: unknown): ReceivePaymentWebhookResponse {
  return receivePaymentWebhookResponseSchema.parse(value);
}

function failure(
  code:
    | "INVALID_REQUEST"
    | "ENDPOINT_UNAVAILABLE"
    | "INVALID_SIGNATURE"
    | "EVENT_OUTSIDE_TOLERANCE"
    | "UNSUPPORTED_EVENT"
    | "IDEMPOTENCY_CONFLICT"
    | "TEMPORARY_UNAVAILABLE"
    | "CONFIGURATION_ERROR",
): ReceivePaymentWebhookResponse {
  return response({
    schemaVersion: 1,
    operation: "RECEIVE_PAYMENT_WEBHOOK",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery:
        code === "TEMPORARY_UNAVAILABLE" ? "RETRY_SAME_COMMAND" : "NONE",
      ...(code === "TEMPORARY_UNAVAILABLE"
        ? { retryAfterMs: DEFAULT_RETRY_AFTER_MS }
        : {}),
    },
  });
}

function persistenceFailure(error: unknown): ReceivePaymentWebhookResponse {
  const parsed = parsePersistenceTransactionFailure(error);
  if (
    parsed !== undefined &&
    [
      "TRANSACTION_ABORTED",
      "TEMPORARY_UNAVAILABLE",
      "UNEXPECTED_ADAPTER_FAILURE",
    ].includes(parsed.error.code)
  ) {
    return failure("TEMPORARY_UNAVAILABLE");
  }
  return failure("CONFIGURATION_ERROR");
}

function verifierFailure(code: string): ReceivePaymentWebhookResponse {
  switch (code) {
    case "INVALID_SIGNATURE":
      return failure("INVALID_SIGNATURE");
    case "EVENT_OUTSIDE_TOLERANCE":
      return failure("EVENT_OUTSIDE_TOLERANCE");
    case "UNSUPPORTED_EVENT":
      return failure("UNSUPPORTED_EVENT");
    case "MALFORMED_PROVIDER_RESPONSE":
      return failure("INVALID_REQUEST");
    case "TEMPORARY_UNAVAILABLE":
    case "UNEXPECTED_ADAPTER_FAILURE":
      return failure("TEMPORARY_UNAVAILABLE");
    case "INVALID_COMMAND":
      return failure("INVALID_REQUEST");
    default:
      return failure("CONFIGURATION_ERROR");
  }
}

function keyManagementFailure(code: string): ReceivePaymentWebhookResponse {
  return [
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(code)
    ? failure("TEMPORARY_UNAVAILABLE")
    : failure("CONFIGURATION_ERROR");
}

function retentionExpiry(receivedAt: string): string | undefined {
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    return undefined;
  }
  return new Date(receivedAtMs + WEBHOOK_PAYLOAD_RETENTION_MS).toISOString();
}

export function createReceivePaymentWebhook(
  dependencies: ReceivePaymentWebhookDependencies,
): (command: unknown) => Promise<ReceivePaymentWebhookResponse> {
  return async (command) => {
    const parsedCommand = receivePaymentWebhookCommandSchema.safeParse(command);
    if (!parsedCommand.success) {
      return failure("INVALID_REQUEST");
    }
    const input = parsedCommand.data;

    let endpoint: PaymentWebhookEndpointDescriptor;
    try {
      const endpointResult =
        await dependencies.transactionManager.runInReliableEventTransaction(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          (repositories) =>
            repositories.paymentWebhookEndpoints.load({
              schemaVersion: 1,
              operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
              endpointId: input.endpointId,
              receivedAt: input.receivedAt,
            }),
        );
      const parsedEndpoint =
        loadPaymentWebhookEndpointResponseSchema.safeParse(endpointResult);
      if (!parsedEndpoint.success) {
        return failure("CONFIGURATION_ERROR");
      }
      if (parsedEndpoint.data.value.decision === "UNAVAILABLE") {
        return failure("ENDPOINT_UNAVAILABLE");
      }
      endpoint = parsedEndpoint.data.value.endpoint;
      if (endpoint.endpointId !== input.endpointId) {
        return failure("CONFIGURATION_ERROR");
      }
    } catch (error: unknown) {
      return persistenceFailure(error);
    }

    let verifier: PaymentWebhookVerifier | undefined;
    try {
      verifier = dependencies.verifierForEndpoint(
        endpoint.adapterKey,
        endpoint.endpointId,
      );
    } catch {
      return failure("CONFIGURATION_ERROR");
    }
    if (verifier === undefined) {
      return failure("CONFIGURATION_ERROR");
    }
    const verificationCommand = {
      schemaVersion: 1,
      operation: "VERIFY_PAYMENT_WEBHOOK",
      endpointId: endpoint.endpointId,
      providerAccountId: endpoint.providerAccountId,
      environment: endpoint.environment,
      verificationKeyReferenceHash: endpoint.verificationKeyReferenceHash,
      rawBodyBase64: input.rawBodyBase64,
      headers: input.headers,
      receivedAt: input.receivedAt,
    } as const;
    let verification: Awaited<
      ReturnType<PaymentWebhookVerifier["verifyPaymentWebhook"]>
    >;
    try {
      verification = await verifier.verifyPaymentWebhook(verificationCommand);
    } catch {
      return failure("TEMPORARY_UNAVAILABLE");
    }
    const parsedVerification =
      paymentWebhookVerificationResponseSchema.safeParse(verification);
    if (
      !parsedVerification.success ||
      !paymentWebhookVerificationResponseMatchesCommand(
        verificationCommand,
        verification,
      )
    ) {
      return failure("CONFIGURATION_ERROR");
    }
    const verifiedResponse = parsedVerification.data;
    if (verifiedResponse.outcome === "FAILURE") {
      return verifierFailure(verifiedResponse.error.code);
    }

    let webhookPayloadId: string;
    let webhookInboxId: string;
    let providerEventRowId: string;
    let associationId: string;
    let payloadSha256: string;
    try {
      webhookPayloadId = dependencies.createId();
      webhookInboxId = dependencies.createId();
      providerEventRowId = dependencies.createId();
      associationId = dependencies.createId();
      payloadSha256 = await dependencies.sha256Hex(input.rawBodyBase64);
    } catch {
      return failure("CONFIGURATION_ERROR");
    }
    const retentionExpiresAt = retentionExpiry(input.receivedAt);
    if (retentionExpiresAt === undefined) {
      return failure("INVALID_REQUEST");
    }

    let encrypted: Awaited<ReturnType<KeyManagementPort["encryptEnvelope"]>>;
    try {
      encrypted = await dependencies.keyManagement.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "WEBHOOK_PAYLOAD",
        subjectId: webhookPayloadId,
        plaintextBase64: input.rawBodyBase64,
      });
    } catch {
      return failure("TEMPORARY_UNAVAILABLE");
    }
    const parsedEncrypted =
      keyManagementPortResponseSchema.safeParse(encrypted);
    if (
      !parsedEncrypted.success ||
      parsedEncrypted.data.operation !== "ENCRYPT_ENVELOPE"
    ) {
      return failure("CONFIGURATION_ERROR");
    }
    const encryptedResponse = parsedEncrypted.data;
    if (encryptedResponse.outcome === "FAILURE") {
      return keyManagementFailure(encryptedResponse.error.code);
    }

    try {
      const receiptCommand =
        recordVerifiedWebhookReceiptCommandSchema.safeParse({
          schemaVersion: 1,
          operation: "RECORD_VERIFIED_WEBHOOK_RECEIPT",
          endpoint,
          webhookPayload: {
            schemaVersion: 1,
            webhookPayloadId,
            ciphertext: encryptedResponse.value.ciphertext,
            encryptedDataKey: encryptedResponse.value.encryptedDataKey,
            encryptionKeyVersion: encryptedResponse.value.keyVersion,
            algorithm: encryptedResponse.value.algorithm,
            payloadSha256,
            retentionExpiresAt,
          },
          webhookInboxId,
          providerEventRowId,
          association: {
            schemaVersion: 1,
            associationId,
            status: "UNMATCHED",
            reasonCode: "PAYMENT_ATTEMPT_ASSOCIATION_DEFERRED",
          },
          signatureTimestamp: verifiedResponse.value.signatureTimestamp,
          receivedAt: input.receivedAt,
          candidate: verifiedResponse.value.candidate,
          job: {
            schemaVersion: 1,
            jobType: "PROCESS_WEBHOOK_INBOX",
            webhookInboxId,
            correlationId: input.correlationId,
            propagation: input.propagation,
          },
        });
      if (!receiptCommand.success) {
        return failure("CONFIGURATION_ERROR");
      }
      const receiptResult =
        await dependencies.transactionManager.runInReliableEventTransaction(
          { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
          (repositories) =>
            repositories.verifiedWebhookReceipts.record(receiptCommand.data),
        );
      const parsedReceipt =
        recordVerifiedWebhookReceiptResponseSchema.safeParse(receiptResult);
      if (!parsedReceipt.success) {
        return failure("CONFIGURATION_ERROR");
      }
      if (parsedReceipt.data.value.decision === "CONFLICT") {
        return failure("IDEMPOTENCY_CONFLICT");
      }
      if (
        parsedReceipt.data.value.providerAccountId !==
          receiptCommand.data.endpoint.providerAccountId ||
        parsedReceipt.data.value.environment !==
          receiptCommand.data.endpoint.environment ||
        parsedReceipt.data.value.providerEventId !==
          receiptCommand.data.candidate.providerEventId
      ) {
        return failure("CONFIGURATION_ERROR");
      }
      if (
        parsedReceipt.data.value.decision === "NEW" &&
        (parsedReceipt.data.value.webhookInboxId !==
          receiptCommand.data.webhookInboxId ||
          parsedReceipt.data.value.providerEventRowId !==
            receiptCommand.data.providerEventRowId)
      ) {
        return failure("CONFIGURATION_ERROR");
      }
      return response({
        schemaVersion: 1,
        operation: "RECEIVE_PAYMENT_WEBHOOK",
        outcome: "SUCCESS",
        value: {
          decision:
            parsedReceipt.data.value.decision === "NEW"
              ? "ACCEPTED_NEW"
              : "ACCEPTED_REPLAY",
          webhookInboxId: parsedReceipt.data.value.webhookInboxId,
          providerEventRowId: parsedReceipt.data.value.providerEventRowId,
        },
      });
    } catch (error: unknown) {
      return persistenceFailure(error);
    }
  };
}
