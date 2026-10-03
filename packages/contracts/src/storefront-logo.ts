import { z } from "zod";
import { sourceHashSchema } from "./content-lifecycle.js";
import { mediaMimeTypeSchema, mediaObjectKeySchema } from "./media-content.js";
import { mediaProcessingErrorSchema } from "./media-processing.js";
import { publicMediaUrlSchema } from "./presentation.js";
export const STOREFRONT_LOGO_PROFILE = Object.freeze({
  version: 1 as const,
  maxEdge: 1024,
  sourceByteLimit: 25 * 1024 * 1024,
  sourcePixelLimit: 40_000_000,
  outputByteLimit: 4 * 1024 * 1024,
  metadataPolicy: "STRIP_ALL_SRGB" as const,
});
export function storefrontLogoObjectKey(
  uploadId: string,
  checksumSha256: string,
) {
  return mediaObjectKeySchema.parse(
    `processed/v1/${z.uuid().parse(uploadId).toLowerCase()}/${sourceHashSchema.parse(checksumSha256)}.webp`,
  );
}
export const storefrontLogoProcessingCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profileVersion: z.literal(1),
    uploadId: z.uuid(),
    source: z.strictObject({
      objectKey: mediaObjectKeySchema,
      checksumSha256: sourceHashSchema,
      mimeType: mediaMimeTypeSchema,
      byteSize: z
        .number()
        .int()
        .positive()
        .max(STOREFRONT_LOGO_PROFILE.sourceByteLimit),
    }),
  })
  .refine(
    (v) => v.source.objectKey === `uploads/v1/${v.uploadId.toLowerCase()}`,
    "Logo source must bind its upload",
  );
export const storefrontLogoImageSchema = z.strictObject({
  objectKey: mediaObjectKeySchema,
  checksumSha256: sourceHashSchema,
  byteSize: z
    .number()
    .int()
    .positive()
    .max(STOREFRONT_LOGO_PROFILE.outputByteLimit),
  width: z.number().int().positive().max(STOREFRONT_LOGO_PROFILE.maxEdge),
  height: z.number().int().positive().max(STOREFRONT_LOGO_PROFILE.maxEdge),
  mimeType: z.literal("image/webp"),
});
export const storefrontLogoProcessingSuccessSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    profileVersion: z.literal(1),
    uploadId: z.uuid(),
    sourceChecksumSha256: sourceHashSchema,
    metadataPolicy: z.literal("STRIP_ALL_SRGB"),
    image: storefrontLogoImageSchema,
  })
  .refine(
    (v) =>
      v.image.objectKey ===
      storefrontLogoObjectKey(v.uploadId, v.image.checksumSha256),
    "Logo output must bind upload and checksum",
  );
export const storefrontLogoProcessingResultSchema = z.union([
  storefrontLogoProcessingSuccessSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("FAILURE"),
    error: mediaProcessingErrorSchema,
  }),
]);
export const storefrontLogoViewSchema = z.strictObject({
  assetId: z.uuid(),
  url: publicMediaUrlSchema.refine((value) => {
    const url = new URL(value);
    return (
      url.search === "" &&
      url.hash === "" &&
      /\/processed\/v1\/[a-f0-9-]{36}\/[a-f0-9]{64}\.webp$/u.test(url.pathname)
    );
  }, "Logo URL must address a processed immutable image"),
  width: z.number().int().positive().max(STOREFRONT_LOGO_PROFILE.maxEdge),
  height: z.number().int().positive().max(STOREFRONT_LOGO_PROFILE.maxEdge),
});
export type StorefrontLogoView = z.infer<typeof storefrontLogoViewSchema>;
export type StorefrontLogoProcessingCommand = z.infer<
  typeof storefrontLogoProcessingCommandSchema
>;
export type StorefrontLogoProcessingResult = z.infer<
  typeof storefrontLogoProcessingResultSchema
>;
export type StorefrontLogoProcessingSuccess = z.infer<
  typeof storefrontLogoProcessingSuccessSchema
>;
