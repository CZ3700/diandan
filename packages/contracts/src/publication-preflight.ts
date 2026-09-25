import { z } from "zod";
import {
  adminContentFailureSchema,
  adminContentRequestSchema,
} from "./admin-content.js";
import {
  baseContentTargetSchema,
  baseContentTextSchema,
} from "./base-content.js";
import {
  contentAuthoringSnapshotSchema,
  contentAuthoringTargetSchema,
} from "./content-authoring.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { mediaAssetSchema, mediaVariantSchema } from "./media-content.js";
import { mediaImageProcessingCommandSchema } from "./media-processing.js";
import {
  contentPublicationCandidateSchema,
  publicationIssueCodeSchema,
  translationApprovalEvidenceSchema,
} from "./publication.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

const uuid = z.uuid();
const version = schemaVersionSchema;
const action = z.enum(["PUBLISH", "ROLLBACK"]);
export const publicationPreflightTargetSchema = z.strictObject({
  owner: contentAuthoringTargetSchema,
  revisionId: uuid,
});
export const publicationPreflightCommandSchema = z.strictObject({
  schemaVersion: version,
  target: publicationPreflightTargetSchema,
  action,
});
export const publicationPreflightRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: publicationPreflightCommandSchema });

// Existing roots stay unchanged; these additional codes belong to the new preflight boundary.
export const publicationPreflightIssueSchema = z.strictObject({
  code: z.union([
    publicationIssueCodeSchema,
    z.enum([
      "CANONICAL_SNAPSHOT_MISMATCH",
      "REVIEW_SELF_APPROVAL",
      "REVIEW_COPY_PROOF_MISSING",
      "REVIEW_COPY_PROOF_MISMATCH",
      "TRANSLATION_ICU_INVALID",
      "EXTENSION_REVIEW_MISSING",
      "EXTENSION_REVIEW_MISMATCH",
      "EXTENSION_NOT_APPROVED",
      "EXTENSION_TRANSLATION_MISSING",
      "EXTENSION_CONTENT_INVALID",
      "MEDIA_PROVENANCE_MISSING",
      "MEDIA_PROVENANCE_MISMATCH",
      "MEDIA_ORIGINAL_RIGHTS_NOT_APPROVED",
      "HERO_ORIGINAL_SOURCE_REUSED",
    ]),
  ]),
  severity: z.enum(["BLOCKER", "WARNING"]),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  locale: supportedLocaleSchema.optional(),
});
export const publicationPreflightResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("PUBLICATION_PREFLIGHT"),
      target: publicationPreflightTargetSchema,
      action,
      headVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      contentHash: sourceHashSchema,
      evaluatedAt: contentTimestampSchema,
      ready: z.boolean(),
      issues: z.array(publicationPreflightIssueSchema),
    })
    .superRefine((value, context) => {
      if (
        value.ready ===
        value.issues.some((issue) => issue.severity === "BLOCKER")
      )
        context.addIssue({
          code: "custom",
          message: "readiness must agree with blockers",
          path: ["ready"],
        });
    }),
  adminContentFailureSchema,
]);

const audit = contentAuthoringSnapshotSchema.shape.translationAudits.element;
/** A canonical edge from the dedicated 0015 copy table; an inheritedFrom hint alone is insufficient. */
export const publicationPreflightCopyProofSchema = z.strictObject({
  target: baseContentTargetSchema,
  targetTranslationId: uuid,
  targetReviewId: uuid,
  authoringReceiptId: uuid,
  source: z.strictObject({
    target: baseContentTargetSchema,
    text: baseContentTextSchema,
    audit,
  }),
  sourceApproval: translationApprovalEvidenceSchema,
});
const extensionApproval = {
  revisionId: uuid,
  subjectId: uuid,
  reviewId: uuid,
  sequence: z.literal(3),
  auditLogId: uuid,
  editorId: uuid,
  structureEditorId: uuid,
  reviewerId: uuid,
  editedAt: contentTimestampSchema,
  reviewedAt: contentTimestampSchema,
  contentHash: sourceHashSchema,
};
export const publicationPreflightExtensionApprovalSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      ...extensionApproval,
      kind: z.literal("IDOL_ALIASES"),
      sourceHash: z.null(),
    }),
    z.strictObject({
      ...extensionApproval,
      kind: z.literal("GIFT_DETAILS"),
      locale: supportedLocaleSchema,
      sourceHash: sourceHashSchema,
    }),
  ],
);
const identityKind = z.enum(["SOURCE", "PROCESSED_MASTER"]);
/** Includes every recorded source of a shared master, not only a favorable source. */
export const publicationPreflightMediaLineageSchema = z.strictObject({
  assetId: uuid,
  identityKind,
  processing: z.array(
    z.strictObject({
      jobId: uuid,
      status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]),
      command: mediaImageProcessingCommandSchema,
      commandHash: sourceHashSchema,
      sourceAsset: mediaAssetSchema,
      sourceIdentityKind: identityKind,
      outputAssetId: uuid,
      output: z.strictObject({
        mediaAssetId: uuid,
        checksumSha256: sourceHashSchema,
        objectKey: mediaAssetSchema.shape.objectKey,
        width: mediaAssetSchema.shape.width,
        height: mediaAssetSchema.shape.height,
        byteSize: mediaAssetSchema.shape.byteSize,
      }),
    }),
  ),
});
const mediaCandidate = z.strictObject({
  objectKind: z.literal("MEDIA_METADATA"),
  currentPublishedRevisionId: uuid.nullable(),
  currentPublication: z
    .strictObject({
      id: uuid,
      action,
      mediaAssetId: uuid,
      targetRevisionId: uuid,
    })
    .nullable(),
  asset: mediaAssetSchema,
  variants: z.array(mediaVariantSchema),
});
export const publicationPreflightContextSchema = z.strictObject({
  schemaVersion: version,
  target: publicationPreflightTargetSchema,
  action,
  headVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  evaluatedAt: contentTimestampSchema,
  previousPublication: z
    .strictObject({
      publicationId: uuid,
      target: publicationPreflightTargetSchema,
      action,
      publishedAt: contentTimestampSchema,
    })
    .nullable(),
  snapshot: contentAuthoringSnapshotSchema,
  candidate: z.union([contentPublicationCandidateSchema, mediaCandidate]),
  mediaSnapshots: z.array(contentAuthoringSnapshotSchema),
  approvals: z.array(translationApprovalEvidenceSchema),
  copies: z.array(publicationPreflightCopyProofSchema),
  extensionApprovals: z.array(publicationPreflightExtensionApprovalSchema),
  mediaLineage: z.array(publicationPreflightMediaLineageSchema),
});
export const publicationPreflightContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    context: publicationPreflightContextSchema,
  }),
  adminContentFailureSchema,
]);

export type PublicationPreflightTarget = z.infer<
  typeof publicationPreflightTargetSchema
>;
export type PublicationPreflightCommand = z.infer<
  typeof publicationPreflightCommandSchema
>;
export type PublicationPreflightRequest = z.infer<
  typeof publicationPreflightRequestSchema
>;
export type PublicationPreflightIssue = z.infer<
  typeof publicationPreflightIssueSchema
>;
export type PublicationPreflightResponse = z.infer<
  typeof publicationPreflightResponseSchema
>;
export type PublicationPreflightContext = z.infer<
  typeof publicationPreflightContextSchema
>;
export type PublicationPreflightContextResponse = z.infer<
  typeof publicationPreflightContextResponseSchema
>;
