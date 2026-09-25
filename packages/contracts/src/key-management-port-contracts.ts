import { z } from "zod";

import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import {
  portBase64Schema,
  portErrorBaseShape,
  validatePortErrorPolicy,
} from "./port-common.js";
import { schemaVersionSchema } from "./versioning.js";

export const envelopeEncryptionPurposeSchema = z.enum([
  "SUPPORT_INTENT_MESSAGE",
  "SUPPORT_INTENT_DISPLAY_NAME",
  "CUSTOMER_CONTACT_EMAIL",
  "FULFILLMENT_PROFILE",
  "PAYMENT_ACTION",
  "WEBHOOK_PAYLOAD",
]);
export const blindIndexPurposeSchema = z.enum([
  "CUSTOMER_CONTACT_EMAIL_LOOKUP",
  "CART_ACCESS_TOKEN",
  "ORDER_ACCESS_TOKEN",
  "ADMIN_EXTERNAL_SUBJECT",
  "ADMIN_SESSION_TOKEN",
  "CSRF_TOKEN",
  "PAYMENT_RETURN_STATE",
  "PROVIDER_ACCOUNT_REFERENCE",
]);
export const keyManagementPortOperationSchema = z.enum([
  "ENCRYPT_ENVELOPE",
  "ENCRYPT_ENVELOPE_FIELDS",
  "DECRYPT_ENVELOPE",
  "COMPUTE_BLIND_INDEX",
]);
export const keyManagementPortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "KEY_VERSION_NOT_FOUND",
  "PLAINTEXT_TOO_LARGE",
  "ENCRYPTION_FAILED",
  "DECRYPTION_FAILED",
  "MAC_FAILED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const keyManagementPortErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: keyManagementPortErrorCodeSchema,
  })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
    }),
  );

const envelopeShape = {
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
} as const;
const encryptCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("ENCRYPT_ENVELOPE"),
  purpose: envelopeEncryptionPurposeSchema,
  subjectId: z.uuid(),
  plaintextBase64: portBase64Schema,
});
const supportIntentEnvelopePurposeSchema = z.enum([
  "SUPPORT_INTENT_MESSAGE",
  "SUPPORT_INTENT_DISPLAY_NAME",
]);
const envelopePlaintextFieldSchema = z.strictObject({
  purpose: supportIntentEnvelopePurposeSchema,
  plaintextBase64: portBase64Schema,
});
const envelopePlaintextFieldsSchema = z
  .array(envelopePlaintextFieldSchema)
  .min(2)
  .max(2)
  .superRefine((fields, context) => {
    if (new Set(fields.map((field) => field.purpose)).size !== fields.length) {
      context.addIssue({
        code: "custom",
        message: "envelope field purposes must be unique",
      });
    }
  });
const encryptFieldsCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("ENCRYPT_ENVELOPE_FIELDS"),
  subjectId: z.uuid(),
  fields: envelopePlaintextFieldsSchema,
});
const decryptCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("DECRYPT_ENVELOPE"),
  purpose: envelopeEncryptionPurposeSchema,
  subjectId: z.uuid(),
  ...envelopeShape,
});
export const MAX_BLIND_INDEX_VALUE_BYTES = 4_051;
const blindIndexValueBase64Schema = portBase64Schema.refine(
  (value) => Math.floor((value.length * 3) / 4) <= MAX_BLIND_INDEX_VALUE_BYTES,
  { message: "blind-index input must fit the AWS KMS 4096-byte message limit" },
);
const blindIndexCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("COMPUTE_BLIND_INDEX"),
  purpose: blindIndexPurposeSchema,
  valueBase64: blindIndexValueBase64Schema,
  keyVersion: keyVersionSchema.optional(),
});
export const keyManagementPortCommandSchema = z.discriminatedUnion(
  "operation",
  [
    encryptCommandSchema,
    encryptFieldsCommandSchema,
    decryptCommandSchema,
    blindIndexCommandSchema,
  ],
);

const failureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: keyManagementPortOperationSchema,
  outcome: z.literal("FAILURE"),
  error: keyManagementPortErrorSchema,
});
const encryptSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("ENCRYPT_ENVELOPE"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject(envelopeShape),
});
const envelopeCiphertextFieldSchema = z.strictObject({
  purpose: supportIntentEnvelopePurposeSchema,
  ciphertext: encryptedValueSchema,
});
const encryptFieldsSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("ENCRYPT_ENVELOPE_FIELDS"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    fields: z
      .array(envelopeCiphertextFieldSchema)
      .min(2)
      .max(2)
      .superRefine((fields, context) => {
        if (
          new Set(fields.map((field) => field.purpose)).size !== fields.length
        ) {
          context.addIssue({
            code: "custom",
            message: "envelope field purposes must be unique",
          });
        }
      }),
    encryptedDataKey: encryptedValueSchema,
    keyVersion: keyVersionSchema,
    algorithm: z.literal("AES_256_GCM"),
  }),
});
const decryptSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("DECRYPT_ENVELOPE"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({ plaintextBase64: portBase64Schema }),
});
const blindIndexSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("COMPUTE_BLIND_INDEX"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    digestBase64: portBase64Schema.refine((value) => value.length === 43, {
      message: "HMAC-SHA-256 digest must be exactly 32 bytes",
    }),
    keyVersion: keyVersionSchema,
    algorithm: z.literal("HMAC_SHA_256"),
  }),
});
export const keyManagementPortResponseSchema = z.union([
  encryptSuccessSchema,
  encryptFieldsSuccessSchema,
  decryptSuccessSchema,
  blindIndexSuccessSchema,
  failureSchema,
]);

export type KeyManagementPortCommand = z.infer<
  typeof keyManagementPortCommandSchema
>;
export type KeyManagementPortResponse = z.infer<
  typeof keyManagementPortResponseSchema
>;
export type KeyManagementPortError = z.infer<
  typeof keyManagementPortErrorSchema
>;
export type KeyManagementPortFailure = z.infer<typeof failureSchema>;
type KeyManagementFailureFor<
  Operation extends KeyManagementPortCommand["operation"],
> = Omit<KeyManagementPortFailure, "operation"> &
  Readonly<{ operation: Operation }>;
export type EncryptEnvelopeCommand = z.infer<typeof encryptCommandSchema>;
export type EncryptEnvelopeResponse =
  | Extract<KeyManagementPortResponse, { operation: "ENCRYPT_ENVELOPE" }>
  | KeyManagementFailureFor<"ENCRYPT_ENVELOPE">;
export type EncryptEnvelopeFieldsCommand = z.infer<
  typeof encryptFieldsCommandSchema
>;
export type EncryptEnvelopeFieldsResponse =
  | Extract<KeyManagementPortResponse, { operation: "ENCRYPT_ENVELOPE_FIELDS" }>
  | KeyManagementFailureFor<"ENCRYPT_ENVELOPE_FIELDS">;
export type DecryptEnvelopeCommand = z.infer<typeof decryptCommandSchema>;
export type DecryptEnvelopeResponse =
  | Extract<KeyManagementPortResponse, { operation: "DECRYPT_ENVELOPE" }>
  | KeyManagementFailureFor<"DECRYPT_ENVELOPE">;
export type ComputeBlindIndexCommand = z.infer<typeof blindIndexCommandSchema>;
export type ComputeBlindIndexResponse =
  | Extract<KeyManagementPortResponse, { operation: "COMPUTE_BLIND_INDEX" }>
  | KeyManagementFailureFor<"COMPUTE_BLIND_INDEX">;
