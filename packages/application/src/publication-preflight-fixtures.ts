// Local test data; not part of the package API.
import {
  SUPPORTED_LOCALES,
  contentAuthoringSnapshotSchema,
  policyRevisionTranslationSchema,
  publicationPreflightContextSchema,
  translationApprovalEvidenceSchema,
} from "@fan-support/contracts";
import {
  computeContentAuthoringSnapshotHash,
  computePolicyTranslationContentHash,
} from "@fan-support/content";

const id = (n: number) =>
  `87000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function policyPreflightFixture() {
  const fields = {
    title: "Fixture privacy",
    summary: "Fixture summary",
    body: "Fictional policy text for integration tests.",
  };
  const hash = computePolicyTranslationContentHash(fields);
  const revision = {
    schemaVersion: 1,
    id: id(1),
    policyKey: "privacy",
    kind: "PRIVACY",
    revision: 1,
    lifecycle: { status: "DRAFT" },
    effectiveAt: "2026-09-06T08:00:00Z",
    createdBy: id(2),
    createdAt: "2026-09-06T07:00:00Z",
  };
  const translations = SUPPORTED_LOCALES.map((locale, index) =>
    policyRevisionTranslationSchema.parse({
      schemaVersion: 1,
      id: id(10 + index),
      policyRevisionId: revision.id,
      locale,
      origin: "HUMAN",
      editorId: id(2),
      editedAt: revision.createdAt,
      sourceHash: hash,
      translatedFromSourceHash: hash,
      ...fields,
      review: {
        status: "APPROVED",
        reviewerId: id(3),
        reviewedAt: "2026-09-06T08:00:00Z",
        reviewedContentHash: hash,
        reviewedSourceHash: hash,
      },
    }),
  );
  const approvals = translations.map((row, index) =>
    translationApprovalEvidenceSchema.parse({
      schemaVersion: 1,
      approvalId: id(30 + index),
      objectKind: "POLICY",
      policyRevisionId: revision.id,
      translationRevisionId: row.id,
      locale: row.locale,
      origin: row.origin,
      editorId: row.editorId,
      reviewerId: id(3),
      reviewedAt: "2026-09-06T08:00:00Z",
      approvedSourceHash: hash,
      approvedContentHash: hash,
      reviewedFieldPaths: ["title", "summary", "body"],
    }),
  );
  const snapshot = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: { kind: "POLICY", policyKey: revision.policyKey },
    revisionId: revision.id,
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: revision.lifecycle,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt,
    contentHash: hash,
    content: {
      kind: "POLICY",
      structure: { kind: revision.kind, effectiveAt: revision.effectiveAt },
      translations: translations.map((row) => ({
        locale: row.locale,
        origin: row.origin,
        fields,
      })),
    },
    translationAudits: translations.map(
      (
        {
          id: translationId,
          locale,
          origin,
          editorId,
          editedAt,
          sourceHash,
          translatedFromSourceHash,
          review,
        },
        index,
      ) => ({
        id: translationId,
        reviewId: approvals[index]!.approvalId,
        reviewSequence: 3,
        locale,
        origin,
        editorId,
        editedAt,
        sourceHash,
        translatedFromSourceHash,
        review,
      }),
    ),
    extensions: {},
  });
  snapshot.contentHash = computeContentAuthoringSnapshotHash(
    snapshot,
  ) as typeof snapshot.contentHash;
  const evaluatedAt = "2026-09-06T09:00:00Z";
  return publicationPreflightContextSchema.parse({
    schemaVersion: 1,
    target: { owner: snapshot.target, revisionId: revision.id },
    action: "PUBLISH",
    headVersion: 0,
    previousPublication: null,
    evaluatedAt,
    snapshot,
    candidate: {
      schemaVersion: 1,
      objectKind: "POLICY",
      action: "PUBLISH",
      currentPublication: null,
      currentPublishedRevisionId: null,
      evaluatedAt,
      revision,
      translations,
    },
    mediaSnapshots: [],
    approvals,
    copies: [],
    extensionApprovals: [],
    mediaLineage: [],
  });
}
