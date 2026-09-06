import {
  baseContentTextSchema,
  SUPPORTED_LOCALES,
  type ContentAuthoringSnapshot,
  type PublicationPreflightContext,
  type PublicationPreflightIssue,
  type PublicationValidationIssue,
  type TranslationApprovalEvidence,
} from "@fan-support/contracts";
import {
  computeBaseContentTextHash,
  projectBaseContentReview,
  sameBaseContentTarget,
} from "./base-content.js";
import { validateTranslationPackage } from "./publication-validation.js";
import { validateTranslationFieldPair } from "./translation-validation.js";
import {
  comparePreflightTime,
  withoutFields,
  preflightIssue,
  rawEqual,
  sameId,
} from "./publication-preflight-shared.js";
type Audit = ContentAuthoringSnapshot["translationAudits"][number];
function parentId(approval: TranslationApprovalEvidence): string {
  switch (approval.objectKind) {
    case "IDOL":
      return approval.idolRevisionId;
    case "GIFT":
      return approval.giftRevisionId;
    case "HOMEPAGE":
      return approval.homepageRevisionId;
    case "POLICY":
      return approval.policyRevisionId;
    case "MEDIA_METADATA":
      return approval.mediaMetadataRevisionId;
  }
}
function matchesApproval(
  audit: Audit,
  revisionId: string,
  kind: ContentAuthoringSnapshot["target"]["kind"],
  evidence: TranslationApprovalEvidence,
): boolean {
  return (
    audit.review.status === "APPROVED" &&
    evidence.objectKind === kind &&
    sameId(evidence.approvalId, audit.reviewId) &&
    sameId(evidence.translationRevisionId, audit.id) &&
    sameId(parentId(evidence), revisionId) &&
    evidence.locale === audit.locale &&
    evidence.approvedSourceHash === audit.translatedFromSourceHash &&
    evidence.approvedContentHash === audit.sourceHash &&
    evidence.origin === audit.origin &&
    evidence.importBatchId === audit.importBatchId &&
    sameId(evidence.editorId, audit.editorId) &&
    sameId(evidence.reviewerId, audit.review.reviewerId) &&
    comparePreflightTime(evidence.reviewedAt, audit.review.reviewedAt) === 0
  );
}
function copyAudit(audit: Audit) {
  return withoutFields(audit, ["id", "reviewId", "inheritedFrom"]);
}
function validateCopy(
  context: PublicationPreflightContext,
  snapshot: ContentAuthoringSnapshot,
  audit: Audit,
): PublicationPreflightIssue["code"] | null {
  const target = {
    owner: snapshot.target,
    revisionId: snapshot.revisionId,
    locale: audit.locale,
  };
  const proofs = context.copies.filter((proof) =>
    sameBaseContentTarget(proof.target, target),
  );
  if (audit.inheritedFrom === undefined)
    return proofs.length === 0 ? null : "REVIEW_COPY_PROOF_MISMATCH";
  if (proofs.length === 0) return "REVIEW_COPY_PROOF_MISSING";
  if (proofs.length !== 1) return "REVIEW_COPY_PROOF_MISMATCH";
  const proof = proofs[0]!;
  const source = proof.source;
  const lineage = audit.inheritedFrom;
  const current = snapshot.content.translations.find(
    (row) => row.locale === audit.locale,
  )!;
  if (
    !sameId(proof.targetTranslationId, audit.id) ||
    !sameId(proof.targetReviewId, audit.reviewId) ||
    !sameBaseContentTarget(source.target, {
      ...target,
      revisionId: lineage.revisionId,
    }) ||
    sameId(source.target.revisionId, snapshot.revisionId) ||
    !sameId(source.audit.id, lineage.translationId) ||
    !sameId(source.audit.reviewId, lineage.reviewId) ||
    source.text.kind !== snapshot.content.kind ||
    source.audit.review.status !== "APPROVED" ||
    source.audit.reviewSequence !== 3 ||
    !rawEqual(source.text.fields, current.fields) ||
    !rawEqual(copyAudit(source.audit), copyAudit(audit)) ||
    computeBaseContentTextHash(source.text) !== source.audit.sourceHash ||
    !matchesApproval(
      source.audit,
      source.target.revisionId,
      source.target.owner.kind,
      proof.sourceApproval,
    )
  )
    return "REVIEW_COPY_PROOF_MISMATCH";
  return null;
}
export function validatePreflightReviewPackages(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const issues: PublicationPreflightIssue[] = [];
  const snapshots = [context.snapshot, ...context.mediaSnapshots];
  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const path =
      snapshotIndex === 0
        ? ["translations"]
        : ["mediaSnapshots", snapshotIndex - 1, "translations"];
    const oldIssues: PublicationValidationIssue[] = [];
    validateTranslationPackage({
      objectKind: snapshot.target.kind,
      parentRevisionId: snapshot.revisionId,
      rows: snapshot.translationAudits,
      approvals: context.approvals,
      computeContentHash: (row) =>
        computeBaseContentTextHash(
          baseContentTextSchema.parse({
            kind: snapshot.content.kind,
            fields: snapshot.content.translations.find(
              (text) => text.locale === row.locale,
            )!.fields,
          }),
        ),
      parentRevisionIdOf: () => snapshot.revisionId,
      evaluatedAt: context.evaluatedAt,
      issues: oldIssues,
      pathPrefix: path,
    });
    issues.push(
      ...oldIssues.map((issue) => {
        const position = issue.path[path.length];
        const locale =
          typeof position === "number"
            ? snapshot.translationAudits[position]?.locale
            : SUPPORTED_LOCALES.find((value) => value === position);
        return {
          ...withoutFields(issue, ["schemaVersion"]),
          ...(locale === undefined ? {} : { locale }),
        };
      }),
    );
    const english = snapshot.content.translations.find(
      (row) => row.locale === "en",
    )!;
    for (const [index, audit] of snapshot.translationAudits.entries()) {
      const localPath = [...path, index];
      const fields = snapshot.content.translations.find(
        (row) => row.locale === audit.locale,
      )!.fields;
      if (validateTranslationFieldPair(english.fields, fields).length > 0)
        issues.push(
          preflightIssue("TRANSLATION_ICU_INVALID", localPath, audit.locale),
        );
      const projected = projectBaseContentReview(snapshot, {
        owner: snapshot.target,
        revisionId: snapshot.revisionId,
        locale: audit.locale,
      });
      if (projected.outcome === "FAILURE")
        issues.push(
          preflightIssue(
            "CANONICAL_SNAPSHOT_MISMATCH",
            localPath,
            audit.locale,
          ),
        );
      if (comparePreflightTime(audit.editedAt, context.evaluatedAt) > 0)
        issues.push(
          preflightIssue(
            "TRANSLATION_APPROVAL_MISMATCH",
            localPath,
            audit.locale,
          ),
        );
      const copyProblem = validateCopy(context, snapshot, audit);
      if (copyProblem)
        issues.push(preflightIssue(copyProblem, localPath, audit.locale));
      if (audit.review.status !== "APPROVED") continue;
      if (
        audit.reviewSequence !== 3 ||
        comparePreflightTime(audit.review.reviewedAt, audit.editedAt) < 0 ||
        comparePreflightTime(audit.review.reviewedAt, context.evaluatedAt) > 0
      )
        issues.push(
          preflightIssue(
            "TRANSLATION_APPROVAL_MISMATCH",
            localPath,
            audit.locale,
          ),
        );
      const proofs = context.approvals.filter((proof) =>
        sameId(proof.translationRevisionId, audit.id),
      );
      if (
        proofs.length === 1 &&
        !matchesApproval(
          audit,
          snapshot.revisionId,
          snapshot.target.kind,
          proofs[0]!,
        )
      )
        issues.push(
          preflightIssue(
            "TRANSLATION_APPROVAL_MISMATCH",
            localPath,
            audit.locale,
          ),
        );
      if (
        sameId(audit.editorId, audit.review.reviewerId) ||
        (sameId(snapshot.createdBy, audit.review.reviewerId) &&
          audit.inheritedFrom === undefined)
      )
        issues.push(
          preflightIssue("REVIEW_SELF_APPROVAL", localPath, audit.locale),
        );
    }
  }
  for (const [index, proof] of context.copies.entries())
    if (
      !snapshots.some((snapshot) =>
        snapshot.translationAudits.some((audit) =>
          sameBaseContentTarget(proof.target, {
            owner: snapshot.target,
            revisionId: snapshot.revisionId,
            locale: audit.locale,
          }),
        ),
      )
    )
      issues.push(
        preflightIssue("REVIEW_COPY_PROOF_MISMATCH", ["copies", index]),
      );
  return issues;
}
