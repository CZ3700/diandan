import { z } from "zod";
import { contentAuthoringSnapshotSchema } from "./content-authoring.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { SUPPORTED_LOCALES } from "./locale.js";
import { mediaAssetSchema, mediaVariantSchema } from "./media-content.js";
import {
  publicationPreflightTargetSchema,
  publicationPreflightCopyProofSchema,
  publicationPreflightExtensionApprovalSchema,
  publicationPreflightMediaLineageSchema,
} from "./publication-preflight.js";
import { translationApprovalEvidenceSchema } from "./publication.js";
import { schemaVersionSchema } from "./versioning.js";

const snapshot = contentAuthoringSnapshotSchema.shape;
export const publicationManifestRevisionSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    target: snapshot.target,
    revisionId: snapshot.revisionId,
    revisionNumber: snapshot.revisionNumber,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
    content: snapshot.content,
    translationAudits: snapshot.translationAudits,
    extensions: snapshot.extensions,
  })
  .superRefine((value, context) => {
    if (value.target.kind !== value.content.kind)
      context.addIssue({
        code: "custom",
        path: ["content", "kind"],
        message: "revision content must match its owner",
      });
    for (const [name, rows] of [
      ["content", value.content.translations],
      ["translationAudits", value.translationAudits],
    ] as const) {
      if (
        rows.length !== SUPPORTED_LOCALES.length ||
        SUPPORTED_LOCALES.some(
          (locale) => rows.filter((row) => row.locale === locale).length !== 1,
        )
      )
        context.addIssue({
          code: "custom",
          path: [name],
          message:
            "immutable publication revisions contain every required locale exactly once",
        });
    }
    if (
      value.translationAudits.some(
        (row) => row.review.status !== "APPROVED" || row.reviewSequence !== 3,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["translationAudits"],
        message:
          "publication revisions retain terminal approved review evidence",
      });
    if (
      new Set(value.translationAudits.map((row) => row.id.toLowerCase()))
        .size !== value.translationAudits.length ||
      new Set(value.translationAudits.map((row) => row.reviewId.toLowerCase()))
        .size !== value.translationAudits.length
    )
      context.addIssue({
        code: "custom",
        path: ["translationAudits"],
        message: "translation and review identities must be distinct",
      });
    if (
      value.extensions.aliases &&
      (value.target.kind !== "IDOL" ||
        value.extensions.aliases.idolRevisionId.toLowerCase() !==
          value.revisionId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        path: ["extensions", "aliases"],
        message: "alias evidence must belong to this revision",
      });
    if (
      value.extensions.details &&
      (value.target.kind !== "GIFT" ||
        value.extensions.details.document.giftRevisionId.toLowerCase() !==
          value.revisionId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        path: ["extensions", "details"],
        message: "detail evidence must belong to this revision",
      });
  });

/** Immutable binary identity only. Current rights and processing eligibility are read separately. */
export const publicationManifestAssetSchema = mediaAssetSchema.omit({
  processingStatus: true,
  processingErrorCode: true,
  rightsStatus: true,
  rightsReference: true,
});
export const publicationManifestVariantSchema = mediaVariantSchema.omit({
  status: true,
});
const lineage = publicationPreflightMediaLineageSchema.shape;
const processing = lineage.processing.element.shape;
export const publicationManifestMediaLineageSchema = z.strictObject({
  assetId: lineage.assetId,
  identityKind: lineage.identityKind,
  processing: z.array(
    z.strictObject({
      jobId: processing.jobId,
      command: processing.command,
      commandHash: processing.commandHash,
      sourceAsset: publicationManifestAssetSchema,
      sourceIdentityKind: processing.sourceIdentityKind,
      outputAssetId: processing.outputAssetId,
      output: processing.output,
    }),
  ),
});
export const publicationManifestSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    target: publicationPreflightTargetSchema,
    revision: publicationManifestRevisionSchema,
    mediaRevisions: z.array(publicationManifestRevisionSchema),
    approvals: z.array(translationApprovalEvidenceSchema),
    copies: z.array(publicationPreflightCopyProofSchema),
    extensionApprovals: z.array(publicationPreflightExtensionApprovalSchema),
    media: z.strictObject({
      assets: z.array(publicationManifestAssetSchema),
      variants: z.array(publicationManifestVariantSchema),
      lineage: z.array(publicationManifestMediaLineageSchema),
    }),
  })
  .superRefine((value, context) => {
    if (
      !samePublicationManifestTarget(value.target, {
        owner: value.revision.target,
        revisionId: value.revision.revisionId,
      })
    )
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "manifest revision must match its target",
      });
    if (
      value.mediaRevisions.some((row) => row.target.kind !== "MEDIA_METADATA")
    )
      context.addIssue({
        code: "custom",
        path: ["mediaRevisions"],
        message: "media dependency revisions must contain media metadata",
      });
    const collections = [
      ["mediaRevisions", value.mediaRevisions.map((row) => row.revisionId)],
      ["approvals", value.approvals.map((row) => row.approvalId)],
      ["copies", value.copies.map((row) => row.targetReviewId)],
      [
        "extensionApprovals",
        value.extensionApprovals.map((row) => row.reviewId),
      ],
      ["assets", value.media.assets.map((row) => row.id)],
      ["variants", value.media.variants.map((row) => row.id)],
      ["lineage", value.media.lineage.map((row) => row.assetId)],
    ] as const;
    for (const [key, ids] of collections)
      if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "manifest proof identities must be unique",
        });
  })
  .meta({
    "x-runtime-invariants": [
      "raw Unicode text and exact approval/copy edges are preserved; parsing alone is not proof of approval",
      "the stable hash excludes lifecycle, current publication, mutable rights, prices and inventory",
      "all recorded current source rights are revalidated independently, including sources added after publication",
      "new publications require a persisted manifest; missing proof cannot select a legacy decoder",
    ],
  });
export const publicationManifestRecordSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    publicationId: z.uuid(),
    target: publicationPreflightTargetSchema,
    action: z.enum(["PUBLISH", "ROLLBACK"]),
    publishedAt: contentTimestampSchema,
    headVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    manifestHash: sourceHashSchema,
    manifest: publicationManifestSchema,
  })
  .superRefine((value, context) => {
    if (!samePublicationManifestTarget(value.target, value.manifest.target))
      context.addIssue({
        code: "custom",
        path: ["manifest", "target"],
        message: "publication record must bind the exact manifest target",
      });
  });

function samePublicationManifestTarget(
  left: z.infer<typeof publicationPreflightTargetSchema>,
  right: z.infer<typeof publicationPreflightTargetSchema>,
): boolean {
  if (
    left.revisionId.toLowerCase() !== right.revisionId.toLowerCase() ||
    left.owner.kind !== right.owner.kind
  )
    return false;
  const a = left.owner,
    b = right.owner;
  switch (a.kind) {
    case "IDOL":
      return (
        b.kind === "IDOL" && a.idolId.toLowerCase() === b.idolId.toLowerCase()
      );
    case "GIFT":
      return (
        b.kind === "GIFT" && a.giftId.toLowerCase() === b.giftId.toLowerCase()
      );
    case "MEDIA_METADATA":
      return (
        b.kind === "MEDIA_METADATA" &&
        a.mediaAssetId.toLowerCase() === b.mediaAssetId.toLowerCase()
      );
    case "POLICY":
      return b.kind === "POLICY" && a.policyKey === b.policyKey;
    case "HOMEPAGE":
      return b.kind === "HOMEPAGE";
  }
}

export type PublicationManifestRevision = z.infer<
  typeof publicationManifestRevisionSchema
>;
export type PublicationManifestAsset = z.infer<
  typeof publicationManifestAssetSchema
>;
export type PublicationManifestVariant = z.infer<
  typeof publicationManifestVariantSchema
>;
export type PublicationManifestMediaLineage = z.infer<
  typeof publicationManifestMediaLineageSchema
>;
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
export type PublicationManifestRecord = z.infer<
  typeof publicationManifestRecordSchema
>;
