import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import {
  sourceHashSchema,
  contentTimestampSchema,
  createRequiredTextSchema,
} from "./content-lifecycle.js";
import {
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  adminIdentityIdSchema,
} from "./identifiers.js";
import {
  mediaMimeTypeSchema,
  mediaObjectKeySchema,
  mediaFocalPointSchema,
} from "./media-content.js";
import {
  mediaFramingPlanSchema,
  mediaFramingRequestSchema,
} from "./media-framing.js";

export const MEDIA_IMAGE_PROFILE = Object.freeze({
  version: 1 as const,
  sourceByteLimit: 25 * 1024 * 1024,
  sourcePixelLimit: 40_000_000,
  outputByteLimit: 32 * 1024 * 1024,
  responsiveWidths: Object.freeze([320, 640, 960]),
  formats: Object.freeze(["AVIF", "WEBP", "JPEG"] as const),
  neutral: Object.freeze({ r: 18, g: 18, b: 22 }),
  metadataPolicy: "STRIP_ALL_SRGB" as const,
});
const jobIdSchema = z.uuid();
const dimensionSchema = z.number().int().positive().max(20_000);
const artifactSchema = z.strictObject({
  objectKey: mediaObjectKeySchema,
  checksumSha256: sourceHashSchema,
  byteSize: z
    .number()
    .int()
    .positive()
    .max(MEDIA_IMAGE_PROFILE.outputByteLimit),
  width: dimensionSchema,
  height: dimensionSchema,
});
const errorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "SOURCE_NOT_FOUND",
  "SOURCE_CHANGED",
  "INVALID_IMAGE",
  "MIME_MISMATCH",
  "DIMENSION_MISMATCH",
  "SOURCE_TOO_SMALL",
  "PIXEL_LIMIT_EXCEEDED",
  "OUTPUT_LIMIT_EXCEEDED",
  "STORAGE_UNAVAILABLE",
  "OBJECT_CONFLICT",
  "PROCESSING_TIMEOUT",
  "UNEXPECTED_PROCESSING_FAILURE",
]);
const transientCodes: readonly string[] = [
  "STORAGE_UNAVAILABLE",
  "PROCESSING_TIMEOUT",
  "UNEXPECTED_PROCESSING_FAILURE",
];
const processingErrorSchema = z
  .strictObject({ code: errorCodeSchema, retryable: z.boolean() })
  .refine((value) => value.retryable === transientCodes.includes(value.code));

export const mediaImageProcessingCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  profileVersion: z.literal(1),
  source: z.strictObject({
    assetId: mediaAssetIdSchema,
    metadataRevisionId: mediaMetadataRevisionIdSchema,
    checksumSha256: sourceHashSchema,
    objectKey: mediaObjectKeySchema,
    mimeType: mediaMimeTypeSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(MEDIA_IMAGE_PROFILE.sourceByteLimit),
    // Encoded source pixels, verified by the decoder before EXIF correction.
    width: dimensionSchema,
    height: dimensionSchema,
  }),
  role: mediaFramingRequestSchema.shape.role,
  fit: mediaFramingRequestSchema.shape.fit,
  focalPoint: mediaFocalPointSchema,
});
export const mediaImageProcessingSuccessSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    commandHash: sourceHashSchema,
    profileVersion: z.literal(1),
    orientation: z.number().int().min(1).max(8),
    plan: mediaFramingPlanSchema,
    metadataPolicy: z.literal("STRIP_ALL_SRGB"),
    master: artifactSchema.extend({ mimeType: z.literal("image/png") }),
    variants: z
      .array(
        artifactSchema.extend({ format: z.enum(["AVIF", "WEBP", "JPEG"]) }),
      )
      .length(12),
  })
  .superRefine((value, ctx) => {
    const { width, height } = value.plan.target;
    if (value.master.width !== width || value.master.height !== height)
      ctx.addIssue({
        code: "custom",
        path: ["master"],
        message: "Master must match the qualified canvas",
      });
    const widths = [...MEDIA_IMAGE_PROFILE.responsiveWidths, width];
    const seen = new Set<string>();
    for (const [index, variant] of value.variants.entries()) {
      const key = `${variant.format}:${variant.width}`;
      if (
        !widths.includes(variant.width) ||
        variant.width * height !== variant.height * width ||
        seen.has(key)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index],
          message:
            "Every format must contain each profile size once at the master aspect ratio",
        });
      }
      seen.add(key);
    }
  });
export const mediaImageProcessingResultSchema = z.union([
  mediaImageProcessingSuccessSchema,
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("FAILURE"),
    error: processingErrorSchema,
  }),
]);

export const mediaProcessingEnqueueCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: jobIdSchema,
  sourceAssetId: mediaAssetIdSchema,
  metadataRevisionId: mediaMetadataRevisionIdSchema,
  role: mediaFramingRequestSchema.shape.role,
  fit: mediaFramingRequestSchema.shape.fit,
  requestedBy: adminIdentityIdSchema,
  reason: createRequiredTextSchema(256),
});
export const mediaProcessingReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: jobIdSchema,
});
export const mediaProcessingClaimCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  leaseToken: z.uuid(),
  leaseSeconds: z.number().int().min(60).max(3600),
});
export const mediaProcessingClaimSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: jobIdSchema,
  leaseToken: z.uuid(),
  attempt: z.number().int().min(1).max(6),
  leaseExpiresAt: contentTimestampSchema,
  command: mediaImageProcessingCommandSchema,
});
export const mediaProcessingSnapshotSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    jobId: jobIdSchema,
    status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]),
    attemptCount: z.number().int().min(0).max(6),
    outputAssetId: mediaAssetIdSchema.nullable(),
    error: processingErrorSchema.nullable(),
    nextAttemptAt: contentTimestampSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if ((value.status === "SUCCEEDED") !== (value.outputAssetId !== null))
      ctx.addIssue({
        code: "custom",
        path: ["outputAssetId"],
        message: "Only successful processing has a canonical output asset",
      });
    if (value.status === "SUCCEEDED" && value.error !== null)
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "Successful processing has no error",
      });
    if (value.status === "FAILED" && value.error === null)
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed processing requires a stable reason",
      });
  });
export const mediaProcessingRepositoryFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "NOT_FOUND",
    "SOURCE_NOT_ELIGIBLE",
    "CONFLICT",
    "STALE_CLAIM",
    "UNAVAILABLE",
  ]),
});
export const mediaProcessingSnapshotResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    value: mediaProcessingSnapshotSchema,
  }),
  mediaProcessingRepositoryFailureSchema,
]);
export const mediaProcessingClaimResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    value: mediaProcessingClaimSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("EMPTY"),
  }),
  mediaProcessingRepositoryFailureSchema,
]);
export const mediaProcessingCompleteCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: jobIdSchema,
  leaseToken: z.uuid(),
  result: mediaImageProcessingSuccessSchema,
});
export const mediaProcessingFailCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: jobIdSchema,
  leaseToken: z.uuid(),
  error: processingErrorSchema,
});
export const mediaProcessingRunResultSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.enum([
    "EMPTY",
    "SUCCEEDED",
    "RETRY_SCHEDULED",
    "FAILED",
    "STALE_CLAIM",
    "UNAVAILABLE",
  ]),
});

export type MediaImageProcessingCommand = z.infer<
  typeof mediaImageProcessingCommandSchema
>;
export type MediaImageProcessingSuccess = z.infer<
  typeof mediaImageProcessingSuccessSchema
>;
export type MediaImageProcessingResult = z.infer<
  typeof mediaImageProcessingResultSchema
>;
export type MediaProcessingError = z.infer<typeof processingErrorSchema>;
export type MediaProcessingEnqueueCommand = z.infer<
  typeof mediaProcessingEnqueueCommandSchema
>;
export type MediaProcessingReadCommand = z.infer<
  typeof mediaProcessingReadCommandSchema
>;
export type MediaProcessingClaimCommand = z.infer<
  typeof mediaProcessingClaimCommandSchema
>;
export type MediaProcessingClaim = z.infer<typeof mediaProcessingClaimSchema>;
export type MediaProcessingSnapshot = z.infer<
  typeof mediaProcessingSnapshotSchema
>;
export type MediaProcessingSnapshotResponse = z.infer<
  typeof mediaProcessingSnapshotResponseSchema
>;
export type MediaProcessingClaimResponse = z.infer<
  typeof mediaProcessingClaimResponseSchema
>;
export type MediaProcessingCompleteCommand = z.infer<
  typeof mediaProcessingCompleteCommandSchema
>;
export type MediaProcessingFailCommand = z.infer<
  typeof mediaProcessingFailCommandSchema
>;
export type MediaProcessingRunResult = z.infer<
  typeof mediaProcessingRunResultSchema
>;
