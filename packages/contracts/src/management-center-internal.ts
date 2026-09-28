import {
  managementImageTargetSchema,
  managementCurrentImageSchema,
  managementImageFocalPointSchema,
} from "./management-image.js";
import { mediaImageProcessingCommandSchema } from "./media-processing.js";
import { z } from "zod";
import { adminPrincipalSchema } from "./admin-content.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { mediaFramingRequestSchema } from "./media-framing.js";
import {
  managementCenterFailureSchema,
  managementCenterIntentSchema,
  managementCenterOperationSchema,
} from "./management-center.js";

const uuid = z.uuid();
export const managementCenterAuthorizationSchema = z.union([
  managementCenterFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    principal: adminPrincipalSchema,
  }),
]);
export const managementCenterPreparedMediaSchema = z
  .strictObject({
    sourceAssetId: uuid,
    assets: z
      .array(
        z.strictObject({
          role: mediaFramingRequestSchema.shape.role,
          assetId: uuid,
          metadataRevisionId: uuid,
          processingJobId: uuid,
        }),
      )
      .min(1)
      .max(3),
  })
  .refine(
    (value) =>
      new Set(value.assets.map((asset) => asset.role)).size ===
      value.assets.length,
  );
export const managementCenterCheckpointSchema = z.strictObject({
  retryRequested: z.boolean(),
  sourceAssetId: uuid.nullable(),
  jobs: z
    .array(
      z.strictObject({
        role: mediaFramingRequestSchema.shape.role,
        metadataRevisionId: uuid,
        jobId: uuid,
      }),
    )
    .max(3),
  preparedMedia: managementCenterPreparedMediaSchema.nullable(),
});
/** Internal PG state. No browser response contains this record or an authentication token. */
export const managementCenterClaimSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: managementCenterOperationSchema,
  actorId: uuid,
  sessionId: uuid,
  requestId: uuid,
  intent: managementCenterIntentSchema,
  intentHash: sourceHashSchema,
  authorizedUntil: contentTimestampSchema,
  leaseTokenDigest: sourceHashSchema,
  leaseExpiresAt: contentTimestampSchema,
  checkpoint: managementCenterCheckpointSchema,
});
export type ManagementCenterAuthorization = z.infer<
  typeof managementCenterAuthorizationSchema
>;
export type ManagementCenterPreparedMedia = z.infer<
  typeof managementCenterPreparedMediaSchema
>;
export type ManagementCenterCheckpoint = z.infer<
  typeof managementCenterCheckpointSchema
>;
export type ManagementCenterClaim = z.infer<typeof managementCenterClaimSchema>;

/** Authorized storage identity remains between application and persistence, never a public DTO. */
export const managementImageSourceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("SUCCESS"),
  target: managementImageTargetSchema,
  currentImage: managementCurrentImageSchema,
  focalPoint: managementImageFocalPointSchema,
  source: mediaImageProcessingCommandSchema.shape.source,
  orientation: z.number().int().min(1).max(8),
});
export type ManagementImageSource = z.infer<typeof managementImageSourceSchema>;
