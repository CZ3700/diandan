import { z } from "zod";
import {
  adminArtistNoteCommandSchema,
  adminArtistNoteVersionSchema,
} from "./admin-artist-notes.js";
import { adminOrdersAccessSchema } from "./admin-orders-persistence.js";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import { contentTimestampSchema } from "./content-lifecycle.js";

/** The store never sees plaintext: a save carries the envelope the application layer produced. */
export const adminArtistNoteEnvelopeSchema = z.strictObject({
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
});
const [context, read, save] = adminArtistNoteCommandSchema.options;
export const adminArtistNoteStoreCommandSchema = z.discriminatedUnion(
  "action",
  [
    context,
    read,
    save
      .omit({ content: true })
      .extend({ envelope: adminArtistNoteEnvelopeSchema }),
  ],
);
export const adminArtistNoteStoreRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  access: adminOrdersAccessSchema,
  command: adminArtistNoteStoreCommandSchema,
});
/** What a prepared read hands to the decrypting caller; the audit and access receipt are already committed. */
export const adminArtistNoteSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("NOTE_SNAPSHOT"),
  accessId: z.uuid(),
  artistId: z.uuid(),
  expiresAt: contentTimestampSchema,
  note: adminArtistNoteVersionSchema,
  envelope: adminArtistNoteEnvelopeSchema,
});

export type AdminArtistNoteEnvelope = z.infer<
  typeof adminArtistNoteEnvelopeSchema
>;
export type AdminArtistNoteStoreCommand = z.infer<
  typeof adminArtistNoteStoreCommandSchema
>;
export type AdminArtistNoteStoreRequest = z.infer<
  typeof adminArtistNoteStoreRequestSchema
>;
export type AdminArtistNoteSnapshot = z.infer<
  typeof adminArtistNoteSnapshotSchema
>;
