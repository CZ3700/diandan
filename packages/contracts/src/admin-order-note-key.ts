import { z } from "zod";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import { portBase64Schema } from "./port-common.js";

/** Independent extension: the frozen v1 generic KMS command remains unchanged. */
export const adminOrderNoteEncryptCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("ENCRYPT_ENVELOPE"),
  purpose: z.literal("ADMIN_ORDER_NOTE"),
  subjectId: z.uuid(),
  plaintextBase64: portBase64Schema,
});
export const adminOrderNoteDecryptCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("DECRYPT_ENVELOPE"),
  purpose: z.literal("ADMIN_ORDER_NOTE"),
  subjectId: z.uuid(),
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
});
export type AdminOrderNoteEncryptCommand = z.infer<
  typeof adminOrderNoteEncryptCommandSchema
>;
export type AdminOrderNoteDecryptCommand = z.infer<
  typeof adminOrderNoteDecryptCommandSchema
>;
