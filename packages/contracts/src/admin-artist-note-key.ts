import { z } from "zod";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import { portBase64Schema } from "./port-common.js";

/** Independent extension (ADR-022 / L3-13): the frozen v1 generic KMS command remains unchanged. */
export const adminArtistNoteEncryptCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("ENCRYPT_ENVELOPE"),
  purpose: z.literal("ARTIST_PRIVATE_NOTE"),
  /** The note version's own id, so a ciphertext cannot be replayed under another version. */
  subjectId: z.uuid(),
  plaintextBase64: portBase64Schema,
});
export const adminArtistNoteDecryptCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("DECRYPT_ENVELOPE"),
  purpose: z.literal("ARTIST_PRIVATE_NOTE"),
  subjectId: z.uuid(),
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
});
export type AdminArtistNoteEncryptCommand = z.infer<
  typeof adminArtistNoteEncryptCommandSchema
>;
export type AdminArtistNoteDecryptCommand = z.infer<
  typeof adminArtistNoteDecryptCommandSchema
>;
