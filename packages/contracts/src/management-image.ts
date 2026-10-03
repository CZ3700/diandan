import { z } from "zod";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { credentiallessHttpsUrlSchema } from "./presentation.js";

// PostgreSQL stores focal coordinates as numeric(6,5); reject precision loss before hashing.
const coordinate = z
  .number()
  .min(0)
  .max(1)
  .refine(
    (value) => Math.round(value * 100_000) / 100_000 === value,
    "At most five decimal places",
  );
export const managementImageFocalPointSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
});
export const managementCurrentImageSchema = z.strictObject({
  assetId: z.uuid(),
  metadataRevisionId: z.uuid(),
});
export const managementImageTargetSchema = z.strictObject({
  kind: z.enum(["ARTIST", "GIFT", "POSTER"]),
  id: z.uuid(),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
});
export const managementImageInputSchema = z.union([
  z.strictObject({ uploadId: z.uuid() }),
  z.strictObject({
    uploadId: z.uuid(),
    focalPoint: managementImageFocalPointSchema,
  }),
  z.strictObject({
    currentImage: managementCurrentImageSchema,
    focalPoint: managementImageFocalPointSchema,
  }),
]);
export const managementOriginalImageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("SUCCESS"),
  kind: z.literal("ORIGINAL_IMAGE"),
  target: managementImageTargetSchema,
  currentImage: managementCurrentImageSchema,
  focalPoint: managementImageFocalPointSchema,
  sourceWidth: z.number().int().positive().max(40_000_000),
  sourceHeight: z.number().int().positive().max(40_000_000),
  download: z.strictObject({
    method: z.literal("GET"),
    url: credentiallessHttpsUrlSchema,
    headers: z
      .record(z.string(), z.string())
      .refine(
        (value) => Object.keys(value).length === 0,
        "Private image GET has no caller-supplied headers",
      ),
    expiresAt: contentTimestampSchema,
  }),
});
export type ManagementImageTarget = z.infer<typeof managementImageTargetSchema>;
export type ManagementOriginalImage = z.infer<
  typeof managementOriginalImageSchema
>;
