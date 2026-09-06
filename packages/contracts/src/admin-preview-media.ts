import { z } from "zod";
import { adminContentFailureSchema } from "./admin-content.js";
import {
  baseContentPreviewRequestSchema,
  baseContentTargetSchema,
} from "./base-content.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  mediaFocalPointSchema,
  mediaMimeTypeSchema,
  mediaObjectKeySchema,
} from "./media-content.js";
import { mediaPortResponseSchema } from "./media-port-contracts.js";
import { schemaVersionSchema } from "./versioning.js";

export const adminPreviewMediaRequestSchema = baseContentPreviewRequestSchema;
const reference = { assetId: z.uuid(), metadataRevisionId: z.uuid() };
const presentation = {
  ...reference,
  alt: z.string().max(300),
  presentationKind: z.enum(["INFORMATIVE", "DECORATIVE"]),
  focalPoint: mediaFocalPointSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: mediaMimeTypeSchema,
};
const unavailable = z.strictObject({
  ...reference,
  status: z.literal("UNAVAILABLE"),
  code: z.enum([
    "PROCESSING",
    "MEDIA_UNAVAILABLE",
    "TRANSLATION_MISSING",
    "RIGHTS_UNAVAILABLE",
  ]),
});
const download = mediaPortResponseSchema.options[2].shape.value.pick({
  method: true,
  url: true,
  headers: true,
  expiresAt: true,
});
function consistentImages(
  images: ReadonlyArray<{
    assetId: string;
    metadataRevisionId: string;
    status: string;
    alt?: string;
    presentationKind?: string;
  }>,
): boolean {
  const keys = images.map((image) =>
    `${image.assetId}:${image.metadataRevisionId}`.toLowerCase(),
  );
  return (
    new Set(keys).size === images.length &&
    images.every(
      (image) =>
        image.status !== "AVAILABLE" ||
        (image.presentationKind === "DECORATIVE"
          ? image.alt === ""
          : (image.alt?.trim().length ?? 0) > 0),
    )
  );
}
export const adminPreviewMediaContextSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  target: baseContentTargetSchema,
  grantId: z.uuid(),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  expiresAt: contentTimestampSchema,
  evaluatedAt: contentTimestampSchema,
  images: z
    .array(
      z.union([
        z.strictObject({
          ...presentation,
          status: z.literal("AVAILABLE"),
          storageClass: z.literal("DERIVATIVE"),
          objectKey: mediaObjectKeySchema,
          checksumSha256: sourceHashSchema,
        }),
        unavailable,
      ]),
    )
    .max(96)
    .refine(
      consistentImages,
      "image references and accessible presentation must be consistent",
    ),
});
export const adminPreviewMediaContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    context: adminPreviewMediaContextSchema,
  }),
  adminContentFailureSchema,
]);
export const adminPreviewMediaResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("PREVIEW_MEDIA"),
    target: baseContentTargetSchema,
    expiresAt: contentTimestampSchema,
    images: z
      .array(
        z.union([
          z.strictObject({
            ...presentation,
            status: z.literal("AVAILABLE"),
            download,
          }),
          unavailable,
        ]),
      )
      .max(96)
      .refine(
        consistentImages,
        "image references and accessible presentation must be consistent",
      ),
  }),
  adminContentFailureSchema,
]);
export type AdminPreviewMediaRequest = z.infer<
  typeof adminPreviewMediaRequestSchema
>;
export type AdminPreviewMediaContext = z.infer<
  typeof adminPreviewMediaContextSchema
>;
export type AdminPreviewMediaContextResponse = z.infer<
  typeof adminPreviewMediaContextResponseSchema
>;
export type AdminPreviewMediaResponse = z.infer<
  typeof adminPreviewMediaResponseSchema
>;
