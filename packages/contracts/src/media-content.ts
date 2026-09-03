import { z } from "zod";

import {
  contentTimestampSchema,
  createRequiredTextSchema,
  positiveRevisionSchema,
  revisionLifecycleSchema,
  sourceHashSchema,
  translationAuditShape,
  validateTranslationAudit,
} from "./content-lifecycle.js";
import {
  adminIdentityIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  mediaVariantIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { publicMediaUrlSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const mediaMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export const mediaObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine((value) => !value.includes("//") && !value.endsWith("/"))
  .brand<"MediaObjectKey">();

export const mediaAssetSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: mediaAssetIdSchema,
  checksumSha256: sourceHashSchema,
  mimeType: mediaMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  objectKey: mediaObjectKeySchema,
  processingStatus: z.enum([
    "PENDING",
    "PROCESSING",
    "READY",
    "FAILED",
    "ARCHIVED",
  ]),
  processingErrorCode: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/u)
    .optional(),
  rightsStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]),
  rightsReference: createRequiredTextSchema(256),
  createdAt: contentTimestampSchema,
});

export const mediaVariantSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: mediaVariantIdSchema,
  mediaAssetId: mediaAssetIdSchema,
  format: z.enum(["AVIF", "WEBP", "JPEG"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  checksumSha256: sourceHashSchema,
  objectKey: mediaObjectKeySchema,
  status: z.enum(["PROCESSING", "READY", "FAILED", "ARCHIVED"]),
});

export const mediaFocalPointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const mediaMetadataRevisionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: mediaMetadataRevisionIdSchema,
  mediaAssetId: mediaAssetIdSchema,
  revision: positiveRevisionSchema,
  lifecycle: revisionLifecycleSchema,
  presentationKind: z.enum(["INFORMATIVE", "DECORATIVE"]),
  focalPoint: mediaFocalPointSchema,
  createdBy: adminIdentityIdSchema,
  createdAt: contentTimestampSchema,
});

export const mediaMetadataRevisionTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: translationRevisionIdSchema,
    mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
    ...translationAuditShape,
    alt: z.string().max(300),
    title: createRequiredTextSchema(160).optional(),
    caption: createRequiredTextSchema(300).optional(),
  })
  .superRefine(validateTranslationAudit);

export const publishedMediaViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("INFORMATIVE"),
    url: publicMediaUrlSchema,
    alt: createRequiredTextSchema(300),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    focalPoint: mediaFocalPointSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("DECORATIVE"),
    url: publicMediaUrlSchema,
    alt: z.literal(""),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    focalPoint: mediaFocalPointSchema,
  }),
]);

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaVariant = z.infer<typeof mediaVariantSchema>;
export type MediaMetadataRevision = z.infer<typeof mediaMetadataRevisionSchema>;
export type MediaMetadataRevisionTranslation = z.infer<
  typeof mediaMetadataRevisionTranslationSchema
>;
export type PublishedMediaView = z.infer<typeof publishedMediaViewSchema>;
