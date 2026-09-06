import {
  SUPPORTED_LOCALES,
  type GiftDetailTranslationFields,
  type PublicationPreflightContext,
  type PublicationPreflightIssue,
} from "@fan-support/contracts";
import { computeIdolAliasContentHash } from "./content-drafts.js";
import {
  computeGiftDetailTranslationContentHash,
  validateGiftDetailFields,
} from "./gift-details.js";
import { validateTranslationFieldPair } from "./translation-validation.js";
import {
  comparePreflightTime,
  preflightIssue,
  sameId,
} from "./publication-preflight-shared.js";
type Proof = PublicationPreflightContext["extensionApprovals"][number];
function validTimes(
  proof: Proof,
  editedAt: string,
  reviewedAt: string,
  evaluatedAt: string,
): boolean {
  return (
    comparePreflightTime(proof.editedAt, editedAt) === 0 &&
    comparePreflightTime(proof.reviewedAt, reviewedAt) === 0 &&
    comparePreflightTime(reviewedAt, editedAt) >= 0 &&
    comparePreflightTime(reviewedAt, evaluatedAt) <= 0
  );
}
// Match stable block/item identity, since localized array order is not its document order.
function orderedFields(fields: GiftDetailTranslationFields): unknown {
  return {
    blocks: fields.blocks
      .map((block) =>
        "items" in block
          ? {
              ...block,
              items: block.items.toSorted((a, b) =>
                a.itemId.localeCompare(b.itemId),
              ),
            }
          : block,
      )
      .toSorted((a, b) => a.blockId.localeCompare(b.blockId)),
  };
}
export function validatePreflightExtensions(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const issues: PublicationPreflightIssue[] = [];
  const snapshot = context.snapshot;
  const { aliases, details } = snapshot.extensions;
  const used = new Set<Proof>();
  if (aliases !== undefined) {
    const path = ["extensions", "aliases"];
    if (aliases.review.status !== "APPROVED")
      issues.push(preflightIssue("EXTENSION_NOT_APPROVED", path));
    const proofs = context.extensionApprovals.filter(
      (proof) =>
        proof.kind === "IDOL_ALIASES" && sameId(proof.subjectId, aliases.id),
    );
    proofs.forEach((proof) => used.add(proof));
    if (proofs.length !== 1)
      issues.push(
        preflightIssue(
          proofs.length === 0
            ? "EXTENSION_REVIEW_MISSING"
            : "EXTENSION_REVIEW_MISMATCH",
          path,
        ),
      );
    else {
      const proof = proofs[0]!;
      if (
        proof.kind !== "IDOL_ALIASES" ||
        !sameId(proof.revisionId, snapshot.revisionId) ||
        !sameId(proof.editorId, aliases.editorId) ||
        !sameId(proof.structureEditorId, aliases.editorId) ||
        proof.contentHash !== computeIdolAliasContentHash(aliases.aliases) ||
        aliases.review.status !== "APPROVED" ||
        !sameId(proof.reviewerId, aliases.review.reviewerId) ||
        !validTimes(
          proof,
          aliases.editedAt,
          aliases.review.reviewedAt,
          context.evaluatedAt,
        )
      )
        issues.push(preflightIssue("EXTENSION_REVIEW_MISMATCH", path));
      if (
        sameId(proof.reviewerId, proof.editorId) ||
        sameId(proof.reviewerId, proof.structureEditorId)
      )
        issues.push(preflightIssue("REVIEW_SELF_APPROVAL", path));
    }
  }
  if (details !== undefined) {
    const { document, translations } = details;
    const english = translations.find((row) => row.locale === "en")!;
    const sourceHash = computeGiftDetailTranslationContentHash(document, {
      blocks: english.blocks,
    });
    for (const locale of SUPPORTED_LOCALES)
      if (!translations.some((row) => row.locale === locale))
        issues.push(
          preflightIssue(
            "EXTENSION_TRANSLATION_MISSING",
            ["extensions", "details", "translations", locale],
            locale,
          ),
        );
    for (const [index, row] of translations.entries()) {
      const path = ["extensions", "details", "translations", index];
      if (
        validateGiftDetailFields(document.blocks, { blocks: row.blocks })
          .length > 0 ||
        validateTranslationFieldPair(orderedFields(english), orderedFields(row))
          .length > 0
      )
        issues.push(
          preflightIssue("EXTENSION_CONTENT_INVALID", path, row.locale),
        );
      if (row.translatedFromSourceHash !== sourceHash)
        issues.push(preflightIssue("TRANSLATION_STALE", path, row.locale));
      if (row.review.status !== "APPROVED")
        issues.push(preflightIssue("EXTENSION_NOT_APPROVED", path, row.locale));
      const proofs = context.extensionApprovals.filter(
        (proof) =>
          proof.kind === "GIFT_DETAILS" &&
          sameId(proof.subjectId, row.id) &&
          proof.locale === row.locale,
      );
      proofs.forEach((proof) => used.add(proof));
      if (proofs.length !== 1)
        issues.push(
          preflightIssue(
            proofs.length === 0
              ? "EXTENSION_REVIEW_MISSING"
              : "EXTENSION_REVIEW_MISMATCH",
            path,
            row.locale,
          ),
        );
      else {
        const proof = proofs[0]!;
        if (
          proof.kind !== "GIFT_DETAILS" ||
          !sameId(proof.revisionId, snapshot.revisionId) ||
          !sameId(proof.editorId, row.editorId) ||
          proof.contentHash !== row.sourceHash ||
          proof.contentHash !==
            computeGiftDetailTranslationContentHash(document, {
              blocks: row.blocks,
            }) ||
          proof.sourceHash !== sourceHash ||
          row.review.status !== "APPROVED" ||
          !sameId(proof.reviewerId, row.review.reviewerId) ||
          !validTimes(
            proof,
            row.editedAt,
            row.review.reviewedAt,
            context.evaluatedAt,
          )
        )
          issues.push(
            preflightIssue("EXTENSION_REVIEW_MISMATCH", path, row.locale),
          );
        if (
          sameId(proof.reviewerId, proof.editorId) ||
          sameId(proof.reviewerId, proof.structureEditorId)
        )
          issues.push(preflightIssue("REVIEW_SELF_APPROVAL", path, row.locale));
      }
    }
    for (const [index, block] of document.blocks.entries()) {
      if (block.kind !== "MEDIA") continue;
      const matches = context.mediaSnapshots.filter((item) =>
        sameId(item.revisionId, block.mediaMetadataRevisionId),
      );
      if (
        matches.length !== 1 ||
        matches[0]!.target.kind !== "MEDIA_METADATA" ||
        !sameId(matches[0]!.target.mediaAssetId, block.mediaAssetId)
      )
        issues.push(
          preflightIssue("MEDIA_METADATA_MISMATCH", [
            "extensions",
            "details",
            "blocks",
            index,
          ]),
        );
    }
  }
  for (const [index, proof] of context.extensionApprovals.entries())
    if (!used.has(proof))
      issues.push(
        preflightIssue("EXTENSION_REVIEW_MISMATCH", [
          "extensionApprovals",
          index,
        ]),
      );
  if (
    new Set(
      context.extensionApprovals.map((proof) => proof.reviewId.toLowerCase()),
    ).size !== context.extensionApprovals.length
  )
    issues.push(
      preflightIssue("EXTENSION_REVIEW_MISMATCH", ["extensionApprovals"]),
    );
  return issues;
}
