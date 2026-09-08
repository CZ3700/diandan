import { Buffer } from "node:buffer";
import { canonicalPublicationValue } from "@fan-support/content";
import {
  keyManagementPortResponseSchema,
  paymentActionSchema,
  paymentRuntimeAttemptRecordSchema,
  paymentRuntimeAttemptViewSchema,
  type CartRuntimeRequestContext,
  type PaymentAction,
  type PaymentRuntimeAttemptRecord,
  type PaymentRuntimeEncryptedAction,
} from "@fan-support/contracts";
import {
  allowedPaymentAction,
  findPaymentProvider,
} from "./payment-runtime-provider.js";
import {
  rejectPayment,
  type PaymentRuntime,
} from "./payment-runtime-context.js";

export async function encryptPaymentAction(
  runtime: PaymentRuntime,
  attempt: PaymentRuntimeAttemptRecord,
  action: PaymentAction | undefined,
): Promise<PaymentRuntimeEncryptedAction | null> {
  if (action === undefined) return null;
  if (action.type === "WAIT") return action;
  const encrypted = keyManagementPortResponseSchema.parse(
    await runtime.keys.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "PAYMENT_ACTION",
      subjectId: attempt.id,
      plaintextBase64: Buffer.from(JSON.stringify(action), "utf8").toString(
        "base64url",
      ),
    }),
  );
  if (
    encrypted.operation !== "ENCRYPT_ENVELOPE" ||
    encrypted.outcome !== "SUCCESS"
  )
    return rejectPayment("TEMPORARY_UNAVAILABLE");
  const expiry = Math.min(
    Date.now() + runtime.configuration.actionTtlMs,
    action.type === "QR_CODE" ? Date.parse(action.expiresAt) : Infinity,
  );
  return {
    schemaVersion: 1,
    type: action.type,
    ciphertext: encrypted.value.ciphertext,
    encryptedDataKey: encrypted.value.encryptedDataKey,
    encryptionKeyVersion: encrypted.value.keyVersion,
    expiresAt: new Date(expiry).toISOString(),
  };
}

async function decryptPaymentAction(
  runtime: PaymentRuntime,
  record: PaymentRuntimeAttemptRecord,
) {
  const encrypted = record.action;
  if (
    !encrypted ||
    record.actionExpired ||
    record.recovery === "EVIDENCE_PENDING"
  )
    return undefined;
  if (encrypted.type === "WAIT") return encrypted;
  const result = keyManagementPortResponseSchema.parse(
    await runtime.keys.decryptEnvelope({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: "PAYMENT_ACTION",
      subjectId: record.id,
      ciphertext: encrypted.ciphertext,
      encryptedDataKey: encrypted.encryptedDataKey,
      keyVersion: encrypted.encryptionKeyVersion,
      algorithm: "AES_256_GCM",
    }),
  );
  if (result.operation !== "DECRYPT_ENVELOPE" || result.outcome !== "SUCCESS")
    return rejectPayment("TEMPORARY_UNAVAILABLE");
  const action = paymentActionSchema.parse(
    JSON.parse(
      Buffer.from(result.value.plaintextBase64, "base64url").toString("utf8"),
    ),
  );
  const provider = findPaymentProvider(runtime.providers, record);
  if (
    !provider ||
    action.type !== encrypted.type ||
    !allowedPaymentAction(action, provider.configuration, [encrypted.type])
  )
    return rejectPayment("PROVIDER_UNAVAILABLE");
  return action;
}

export async function readAuthorizedPayment(
  runtime: PaymentRuntime,
  context: CartRuntimeRequestContext,
  checkoutSessionId: PaymentRuntimeAttemptRecord["checkoutSessionId"],
  attemptId: PaymentRuntimeAttemptRecord["id"],
) {
  const read = (expectedVersion?: number) =>
    runtime.run(async ({ paymentRuntime }) => {
      const value = await paymentRuntime.readAttempt({
        schemaVersion: 1,
        accesses: context.accesses,
        checkoutSessionId,
        attemptId,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
      if (!value) return rejectPayment("ATTEMPT_NOT_FOUND");
      const record = paymentRuntimeAttemptRecordSchema.parse(value);
      if (
        record.checkoutSessionId.toLowerCase() !==
          checkoutSessionId.toLowerCase() ||
        record.id.toLowerCase() !== attemptId.toLowerCase()
      )
        return rejectPayment("INVALID_ACCESS");
      return record;
    });
  const record = await read();
  const action = await decryptPaymentAction(runtime, record);
  if (action !== undefined && action.type !== "WAIT") {
    const confirmed = await read(record.version);
    if (
      canonicalPublicationValue(confirmed) !== canonicalPublicationValue(record)
    )
      return rejectPayment("VERSION_CONFLICT");
  }
  return paymentRuntimeAttemptViewSchema.parse({
    schemaVersion: 1,
    id: record.id,
    checkoutSessionId: record.checkoutSessionId,
    version: record.version,
    environment: record.environment,
    status: record.status,
    requestedLocale: record.requestedLocale,
    providerLocale: record.providerLocale,
    providerLocaleFallbackUsed: record.providerLocaleFallbackUsed,
    recovery: record.recovery,
    canRetry: record.canRetry,
    actionExpired: record.actionExpired,
    updatedAt: record.updatedAt,
    ...(action === undefined ? {} : { action }),
    ...(action !== undefined &&
    action.type !== "WAIT" &&
    record.action?.type !== "WAIT"
      ? { actionExpiresAt: record.action?.expiresAt }
      : {}),
  });
}
