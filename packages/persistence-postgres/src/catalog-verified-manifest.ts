import {
  translationPublicationManifestEntrySchema,
  type LegacyPublishedContentContext,
  type TranslationPublicationManifestEntry,
  type TranslationApprovalEvidence,
} from "@fan-support/contracts";

function parentReference(approval: TranslationApprovalEvidence) {
  switch (approval.objectKind) {
    case "GIFT":
      return { giftRevisionId: approval.giftRevisionId };
    case "IDOL":
      return { idolRevisionId: approval.idolRevisionId };
    case "HOMEPAGE":
      return { homepageRevisionId: approval.homepageRevisionId };
    case "POLICY":
      return { policyRevisionId: approval.policyRevisionId };
    case "MEDIA_METADATA":
      return { mediaMetadataRevisionId: approval.mediaMetadataRevisionId };
  }
}

/** Preserve the exact frozen approval identities after the complete publication validator succeeds.
 * This never restores missing localized text; English must still exist in the current SQL rows. */
export function catalogVerifiedManifest(
  context: LegacyPublishedContentContext,
): TranslationPublicationManifestEntry[] {
  return context.publication.manifest.approvals.map((approval) => {
    return translationPublicationManifestEntrySchema.parse({
      schemaVersion: 1,
      publicationId: context.publication.publicationId,
      objectKind: approval.objectKind,
      approvalId: approval.approvalId,
      translationRevisionId: approval.translationRevisionId,
      locale: approval.locale,
      approvedSourceHash: approval.approvedSourceHash,
      approvedContentHash: approval.approvedContentHash,
      origin: approval.origin,
      ...(approval.importBatchId === undefined
        ? {}
        : { importBatchId: approval.importBatchId }),
      ...parentReference(approval),
    });
  });
}
