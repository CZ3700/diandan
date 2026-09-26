import { z } from "zod";
import {
  adminOrdersCommandSchema,
  adminOrdersNoteMetadataSchema,
  adminOrdersPermissionSchema,
} from "./admin-orders.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  deliveryProofProcessingSuccessSchema,
  deliveryProofRenditionNameSchema,
  deliveryProofRenditionSchema,
  deliveryProofSourceSchema,
} from "./delivery-proof.js";

const uuid = z.uuid();
export const adminOrdersAccessSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  requestId: uuid,
  correlationId: uuid,
});
export const adminOrdersPrincipalSchema = z.strictObject({
  actorId: uuid,
  sessionId: uuid,
  authorizedAt: contentTimestampSchema,
  sessionExpiresAt: contentTimestampSchema,
  permissions: z.array(adminOrdersPermissionSchema).max(8),
  reviewLocales: z.array(supportedLocaleSchema).max(7),
});
export const adminOrdersNoteEnvelopeSchema = z.strictObject({
  noteId: uuid,
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
});
const commands = adminOrdersCommandSchema.options;
export const adminOrdersStoreCommandSchema = z.discriminatedUnion("action", [
  commands[0],
  commands[1],
  commands[2],
  commands[3],
  commands[4],
  commands[5],
  commands[6],
  commands[7],
  commands[8],
  adminOrdersCommandSchema.options[9]
    .omit({ note: true })
    .extend({ envelope: adminOrdersNoteEnvelopeSchema }),
  commands[10],
  commands[11],
  commands[12],
  commands[13],
  commands[14],
  commands[15],
  commands[16],
]);
/** The optional keyed digest is required on mutations; no plaintext notes or raw credentials cross the persistence boundary. */
export const adminOrdersStoreRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    access: adminOrdersAccessSchema,
    command: adminOrdersStoreCommandSchema,
    requestHash: sourceHashSchema.nullable(),
  })
  .refine((v) => !("idempotencyKey" in v.command) || v.requestHash !== null);
export const adminOrdersPrivateSnapshotSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("MESSAGE"),
    accessId: uuid,
    orderId: uuid,
    itemId: uuid,
    supportIntentId: uuid,
    intentVersion: checkoutVersionSchema,
    expiresAt: contentTimestampSchema,
    reviewLocale: supportedLocaleSchema,
    displayMode: z.enum(["anonymous", "nickname"]),
    fanMessageLocale: z.union([supportedLocaleSchema, z.literal("und")]),
    fanMessageCiphertext: encryptedValueSchema.nullable(),
    displayNameCiphertext: encryptedValueSchema.nullable(),
    encryptedDataKey: encryptedValueSchema,
    keyVersion: keyVersionSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("NOTES"),
    accessId: uuid,
    orderId: uuid,
    expiresAt: contentTimestampSchema,
    notes: z
      .array(
        adminOrdersNoteMetadataSchema.extend({
          envelope: adminOrdersNoteEnvelopeSchema,
        }),
      )
      .max(50),
  }),
]);
export const adminOrdersConfirmPrivateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  access: adminOrdersAccessSchema,
  accessId: uuid,
});
export const adminOrdersPrivateConfirmationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("SUCCESS"),
  kind: z.literal("PRIVATE_CONFIRMED"),
  accessId: uuid,
});
const success = {
  schemaVersion: z.literal(1),
  outcome: z.literal("SUCCESS"),
};
/** A committed source reservation; signing its upload grant happens after commit. */
export const adminOrdersProofReservationSchema = z.strictObject({
  ...success,
  kind: z.literal("PROOF_RESERVATION"),
  orderId: uuid,
  fulfillmentId: uuid,
  uploadId: uuid,
  replayed: z.boolean(),
  source: deliveryProofSourceSchema,
  createdAt: contentTimestampSchema,
  expiresAt: contentTimestampSchema,
  authorizedAt: contentTimestampSchema,
  sessionExpiresAt: contentTimestampSchema,
});
export const adminOrdersProofUploadStateSchema = z
  .strictObject({
    ...success,
    kind: z.literal("PROOF_UPLOAD_STATE"),
    orderId: uuid,
    fulfillmentId: uuid,
    uploadId: uuid,
    status: z.enum(["RESERVED", "READY"]),
    source: deliveryProofSourceSchema,
    expiresAt: contentTimestampSchema,
    display: deliveryProofRenditionSchema.nullable(),
    thumbnail: deliveryProofRenditionSchema.nullable(),
  })
  .refine(
    (value) =>
      (value.status === "READY") ===
        (value.display !== null && value.thumbnail !== null) &&
      (value.display === null) === (value.thumbnail === null),
  );
/** Records verified renditions; the stored source identity must still match exactly. */
export const adminOrdersProofCompletionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    access: adminOrdersAccessSchema,
    orderId: uuid,
    uploadId: uuid,
    source: deliveryProofSourceSchema,
    result: deliveryProofProcessingSuccessSchema,
  })
  .refine((value) => value.result.uploadId === value.uploadId);
export const adminOrdersProofRenditionLocationSchema = z.strictObject({
  ...success,
  kind: z.literal("PROOF_RENDITION"),
  orderId: uuid,
  proofId: uuid,
  rendition: deliveryProofRenditionNameSchema,
  identity: deliveryProofRenditionSchema,
  authorizedAt: contentTimestampSchema,
  sessionExpiresAt: contentTimestampSchema,
});
export type AdminOrdersAccess = z.infer<typeof adminOrdersAccessSchema>;
export type AdminOrdersProofReservation = z.infer<
  typeof adminOrdersProofReservationSchema
>;
export type AdminOrdersProofUploadState = z.infer<
  typeof adminOrdersProofUploadStateSchema
>;
export type AdminOrdersProofCompletion = z.infer<
  typeof adminOrdersProofCompletionSchema
>;
export type AdminOrdersProofRenditionLocation = z.infer<
  typeof adminOrdersProofRenditionLocationSchema
>;
export type AdminOrdersPrincipal = z.infer<typeof adminOrdersPrincipalSchema>;
export type AdminOrdersStoreRequest = z.infer<
  typeof adminOrdersStoreRequestSchema
>;
export type AdminOrdersPrivateSnapshot = z.infer<
  typeof adminOrdersPrivateSnapshotSchema
>;
export type AdminOrdersConfirmPrivate = z.infer<
  typeof adminOrdersConfirmPrivateSchema
>;
export type AdminOrdersPrivateConfirmation = z.infer<
  typeof adminOrdersPrivateConfirmationSchema
>;
