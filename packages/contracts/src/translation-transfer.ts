import { z } from "zod";
import {
  adminContentFailureSchema,
  adminContentRequestSchema,
  adminMutationResponseSchema,
} from "./admin-content.js";
import { baseContentTextSchema } from "./base-content.js";
import { contentAuthoringTargetSchema } from "./content-authoring.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { supportedLocaleSchema } from "./locale.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { schemaVersionSchema } from "./versioning.js";

export const translationTransferTargetSchema = z.strictObject({
  owner: contentAuthoringTargetSchema,
  revisionId: z.uuid(),
});
export const translationFieldConstraintSchema = z.strictObject({
  path: z.string().regex(/^[A-Za-z][A-Za-z0-9.*-]{0,255}$/u),
  required: z.boolean(),
  format: z.enum(["PLAIN_TEXT", "CONTROLLED_RICH_TEXT"]),
  maxLength: z.number().int().positive(),
  allowedTags: z
    .array(z.string().regex(/^[a-z]+$/u))
    .max(16)
    .optional(),
});
export const translationTransferPackageSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    packageId: z.uuid(),
    target: translationTransferTargetSchema,
    authoringHeadVersion: z.number().int().positive(),
    sourceSnapshotHash: sourceHashSchema,
    english: z.strictObject({
      sourceHash: sourceHashSchema,
      text: baseContentTextSchema,
    }),
    entries: z
      .array(
        z.strictObject({
          locale: supportedLocaleSchema,
          text: baseContentTextSchema.nullable(),
        }),
      )
      .min(1)
      .max(7),
    constraints: z.array(translationFieldConstraintSchema).max(256),
    exportedAt: contentTimestampSchema,
  })
  .superRefine((value, context) => {
    if (
      new Set(value.entries.map((entry) => entry.locale)).size !==
        value.entries.length ||
      value.english.text.kind !== value.target.owner.kind ||
      value.entries.some(
        (entry) =>
          entry.text !== null && entry.text.kind !== value.target.owner.kind,
      )
    )
      context.addIssue({
        code: "custom",
        message: "package locales and typed content must match its owner",
      });
  });
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
export const translationTransferCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    action: z.literal("EXPORT"),
    target: translationTransferTargetSchema,
    locales: z
      .array(supportedLocaleSchema)
      .min(1)
      .max(7)
      .refine((rows) => new Set(rows).size === rows.length),
    reasonCode: reason,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    action: z.literal("IMPORT"),
    package: translationTransferPackageSchema.refine(
      (packet) => packet.entries.every((entry) => entry.text !== null),
      "all imported translations must be filled",
    ),
    reasonCode: reason,
    idempotencyKey: idempotencyKeySchema,
  }),
]);
export const translationTransferRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: translationTransferCommandSchema });
export const translationTransferResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("TRANSLATION_EXPORT"),
    package: translationTransferPackageSchema,
    replayed: z.boolean(),
  }),
  adminMutationResponseSchema,
  adminContentFailureSchema,
]);
export const translationExportReceiptSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: z.uuid(),
  target: translationTransferTargetSchema,
  authoringHeadVersion: z.number().int().positive(),
  sourceSnapshotHash: sourceHashSchema,
  englishSourceHash: sourceHashSchema,
  locales: z.array(supportedLocaleSchema).min(1).max(7),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  createdAt: contentTimestampSchema,
});
export const translationExportReceiptResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    receipt: translationExportReceiptSchema,
  }),
  adminContentFailureSchema,
]);
export const translationExportCreateCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  receipt: translationExportReceiptSchema.omit({ id: true, createdAt: true }),
  reasonCode: reason,
  requestId: z.uuid(),
});
export const translationExportReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: z.uuid(),
});
export const translationImportRecordCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: z.uuid(),
  exportReceiptId: z.uuid(),
  revisionId: z.uuid(),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  requestId: z.uuid(),
});
export type TranslationTransferTarget = z.infer<
  typeof translationTransferTargetSchema
>;
export type TranslationFieldConstraint = z.infer<
  typeof translationFieldConstraintSchema
>;
export type TranslationTransferPackage = z.infer<
  typeof translationTransferPackageSchema
>;
export type TranslationTransferCommand = z.infer<
  typeof translationTransferCommandSchema
>;
export type TranslationTransferRequest = z.infer<
  typeof translationTransferRequestSchema
>;
export type TranslationTransferResponse = z.infer<
  typeof translationTransferResponseSchema
>;
export type TranslationExportReceipt = z.infer<
  typeof translationExportReceiptSchema
>;
export type TranslationExportReceiptResponse = z.infer<
  typeof translationExportReceiptResponseSchema
>;
export type TranslationExportCreateCommand = z.infer<
  typeof translationExportCreateCommandSchema
>;
export type TranslationExportReadCommand = z.infer<
  typeof translationExportReadCommandSchema
>;
export type TranslationImportRecordCommand = z.infer<
  typeof translationImportRecordCommandSchema
>;
