import {
  SUPPORTED_LOCALES,
  translationApprovalEvidenceSchema,
} from "@fan-support/contracts";
import type {
  PublicationIssueCode,
  PublicationValidationIssue,
  RevisionLifecycle,
  TranslationApprovalEvidence,
} from "@fan-support/contracts";

import { canonicalUuid, sameOptionalUuid } from "./uuid-identity.js";

export type ApprovalObjectKind = TranslationApprovalEvidence["objectKind"];
export type SafePath = readonly (string | number)[];
export type TranslationEffectiveState =
  "MISSING" | "DRAFT" | "IN_REVIEW" | "APPROVED" | "STALE";

type TranslationReview =
  | Readonly<{ status: "DRAFT" }>
  | Readonly<{ status: "IN_REVIEW"; submittedAt: string }>
  | Readonly<{
      status: "APPROVED";
      reviewerId: string;
      reviewedAt: string;
      reviewedSourceHash: string;
      reviewedContentHash: string;
    }>;

export type ApprovableTranslationRow = Readonly<{
  id: string;
  locale: string;
  sourceHash: string;
  translatedFromSourceHash: string;
  origin: "HUMAN" | "MACHINE" | "IMPORT";
  importBatchId?: string | undefined;
  editorId: string;
  editedAt: string;
  review: TranslationReview;
}>;

export function publicationIssue(
  code: PublicationIssueCode,
  path: SafePath,
  severity: "BLOCKER" | "WARNING" = "BLOCKER",
): PublicationValidationIssue {
  return { schemaVersion: 1, severity, code, path: [...path] };
}

export function safeSchemaPath(
  path: readonly PropertyKey[],
): (string | number)[] {
  return path.map((segment) =>
    typeof segment === "number" ? segment : String(segment),
  );
}

export function validatePublicationLifecycle(input: {
  action: "PUBLISH" | "ROLLBACK";
  lifecycle: RevisionLifecycle;
  createdAt: string;
  evaluatedAt: string;
  issues: PublicationValidationIssue[];
  pathPrefix?: SafePath;
}): void {
  const pathPrefix = input.pathPrefix ?? ["revision"];
  const expectedStatus =
    input.action === "PUBLISH" ? "VALIDATED" : "SUPERSEDED";
  if (input.lifecycle.status !== expectedStatus) {
    input.issues.push(
      publicationIssue("REVISION_NOT_VALIDATED", [
        ...pathPrefix,
        "lifecycle",
        "status",
      ]),
    );
  }

  validateRevisionTimeline({
    lifecycle: input.lifecycle,
    createdAt: input.createdAt,
    evaluatedAt: input.evaluatedAt,
    issues: input.issues,
    pathPrefix,
  });
}

export function validateRevisionTimeline(input: {
  lifecycle: RevisionLifecycle;
  createdAt: string;
  evaluatedAt: string;
  issues: PublicationValidationIssue[];
  pathPrefix: SafePath;
}): void {
  const pathPrefix = input.pathPrefix;

  const createdAt = Date.parse(input.createdAt);
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (createdAt > evaluatedAt) {
    input.issues.push(
      publicationIssue("REVISION_LIFECYCLE_TIME_INVALID", [
        ...pathPrefix,
        "createdAt",
      ]),
    );
  }

  const lifecycleTimestamps = [
    [
      "validatedAt",
      "validatedAt" in input.lifecycle
        ? input.lifecycle.validatedAt
        : undefined,
    ],
    [
      "publishedAt",
      "publishedAt" in input.lifecycle
        ? input.lifecycle.publishedAt
        : undefined,
    ],
    [
      "supersededAt",
      "supersededAt" in input.lifecycle
        ? input.lifecycle.supersededAt
        : undefined,
    ],
    [
      "archivedAt",
      "archivedAt" in input.lifecycle ? input.lifecycle.archivedAt : undefined,
    ],
  ] as const;
  for (const [timestampField, timestampValue] of lifecycleTimestamps) {
    if (timestampValue === undefined) {
      continue;
    }
    const timestamp = Date.parse(timestampValue);
    if (timestamp < createdAt || timestamp > evaluatedAt) {
      input.issues.push(
        publicationIssue("REVISION_LIFECYCLE_TIME_INVALID", [
          ...pathPrefix,
          "lifecycle",
          timestampField,
        ]),
      );
    }
  }
}

export function validateCurrentPublicationEvidence(input: {
  action: "PUBLISH" | "ROLLBACK";
  currentPublication: Readonly<{
    id: string;
    targetRevisionId: string;
  }> | null;
  currentPublishedRevisionId: string | null;
  targetRevisionId: string;
  issues: PublicationValidationIssue[];
  currentRevisionPath: SafePath;
}): void {
  const hasPublication = input.currentPublication !== null;
  const hasPublishedRevision = input.currentPublishedRevisionId !== null;

  if (hasPublication !== hasPublishedRevision || input.action === "ROLLBACK") {
    if (!hasPublication || !hasPublishedRevision) {
      input.issues.push(
        publicationIssue("CURRENT_PUBLICATION_EVIDENCE_MISSING", [
          "currentPublication",
        ]),
      );
      return;
    }
  }

  if (
    input.currentPublication !== null &&
    input.currentPublishedRevisionId !== null &&
    input.currentPublication.targetRevisionId.toLowerCase() !==
      input.currentPublishedRevisionId.toLowerCase()
  ) {
    input.issues.push(
      publicationIssue("CURRENT_PUBLICATION_EVIDENCE_MISMATCH", [
        "currentPublication",
        "targetRevisionId",
      ]),
    );
  }

  if (
    input.action === "ROLLBACK" &&
    input.currentPublishedRevisionId?.toLowerCase() ===
      input.targetRevisionId.toLowerCase()
  ) {
    input.issues.push(
      publicationIssue("ROLLBACK_TARGET_INVALID", input.currentRevisionPath),
    );
  }

  if (
    input.action === "PUBLISH" &&
    input.currentPublishedRevisionId?.toLowerCase() ===
      input.targetRevisionId.toLowerCase()
  ) {
    input.issues.push(
      publicationIssue(
        "PUBLISH_TARGET_ALREADY_CURRENT",
        input.currentRevisionPath,
      ),
    );
  }
}

export function validateReferencedMediaLifecycle(input: {
  action: "PUBLISH" | "ROLLBACK";
  referencedMetadataRevisionIds: ReadonlySet<string>;
  metadataRevisions: readonly Readonly<{
    id: string;
    createdAt: string;
    lifecycle: RevisionLifecycle;
  }>[];
  evaluatedAt: string;
  issues: PublicationValidationIssue[];
  pathPrefix?: SafePath;
}): void {
  const pathPrefix = input.pathPrefix ?? ["mediaMetadataRevisions"];
  const referencedMetadataRevisionIds = new Set(
    [...input.referencedMetadataRevisionIds].map(canonicalUuid),
  );
  for (const [index, metadata] of input.metadataRevisions.entries()) {
    if (!referencedMetadataRevisionIds.has(canonicalUuid(metadata.id))) {
      continue;
    }

    const permittedStatuses =
      input.action === "PUBLISH"
        ? new Set(["VALIDATED", "PUBLISHED"])
        : new Set(["PUBLISHED", "SUPERSEDED"]);
    if (!permittedStatuses.has(metadata.lifecycle.status)) {
      input.issues.push(
        publicationIssue("MEDIA_METADATA_NOT_PUBLISHABLE", [
          ...pathPrefix,
          index,
          "lifecycle",
          "status",
        ]),
      );
    }
    validateRevisionTimeline({
      lifecycle: metadata.lifecycle,
      createdAt: metadata.createdAt,
      evaluatedAt: input.evaluatedAt,
      issues: input.issues,
      pathPrefix: [...pathPrefix, index],
    });
  }
}

export function deriveTranslationEffectiveState(
  row:
    | Pick<ApprovableTranslationRow, "translatedFromSourceHash" | "review">
    | undefined,
  currentEnglishSourceHash: string,
): TranslationEffectiveState {
  if (row === undefined) {
    return "MISSING";
  }
  if (row.translatedFromSourceHash !== currentEnglishSourceHash) {
    return "STALE";
  }
  return row.review.status;
}

export function parseApprovalEvidence(
  input: unknown,
  issues: PublicationValidationIssue[],
  pathPrefix: SafePath = ["approvalEvidence"],
): readonly TranslationApprovalEvidence[] | undefined {
  const parsed = translationApprovalEvidenceSchema.array().safeParse(input);
  if (!parsed.success) {
    for (const schemaIssue of parsed.error.issues) {
      issues.push(
        publicationIssue("SCHEMA_INVALID", [
          ...pathPrefix,
          ...safeSchemaPath(schemaIssue.path),
        ]),
      );
    }
    return undefined;
  }

  const indexesByApprovalId = new Map<string, number[]>();
  for (const [index, approval] of parsed.data.entries()) {
    const canonicalApprovalId = approval.approvalId.toLowerCase();
    const indexes = indexesByApprovalId.get(canonicalApprovalId) ?? [];
    indexes.push(index);
    indexesByApprovalId.set(canonicalApprovalId, indexes);
  }
  for (const indexes of indexesByApprovalId.values()) {
    if (indexes.length < 2) {
      continue;
    }
    for (const index of indexes) {
      issues.push(
        publicationIssue("TRANSLATION_APPROVAL_DUPLICATE", [
          ...pathPrefix,
          index,
          "approvalId",
        ]),
      );
    }
  }
  return parsed.data;
}

function approvalParentRevisionId(
  evidence: TranslationApprovalEvidence,
): string {
  switch (evidence.objectKind) {
    case "IDOL":
      return evidence.idolRevisionId;
    case "GIFT":
      return evidence.giftRevisionId;
    case "HOMEPAGE":
      return evidence.homepageRevisionId;
    case "POLICY":
      return evidence.policyRevisionId;
    case "MEDIA_METADATA":
      return evidence.mediaMetadataRevisionId;
  }
}

function validateApproval(
  row: ApprovableTranslationRow,
  rowIndex: number,
  objectKind: ApprovalObjectKind,
  parentRevisionId: string,
  approvals: readonly TranslationApprovalEvidence[],
  evaluatedAt: string,
  pathPrefix: SafePath,
  issues: PublicationValidationIssue[],
): void {
  if (row.review.status !== "APPROVED") {
    return;
  }

  const matches = approvals.filter(
    (evidence) =>
      evidence.objectKind === objectKind &&
      canonicalUuid(evidence.translationRevisionId) === canonicalUuid(row.id),
  );
  const path = [...pathPrefix, rowIndex, "approval"] as const;
  if (matches.length === 0) {
    issues.push(publicationIssue("TRANSLATION_APPROVAL_MISSING", path));
    return;
  }
  if (matches.length > 1) {
    issues.push(publicationIssue("TRANSLATION_APPROVAL_DUPLICATE", path));
    return;
  }

  const evidence = matches[0]!;
  const evidenceMatches =
    canonicalUuid(approvalParentRevisionId(evidence)) ===
      canonicalUuid(parentRevisionId) &&
    evidence.locale === row.locale &&
    evidence.approvedSourceHash === row.translatedFromSourceHash &&
    evidence.approvedContentHash === row.sourceHash &&
    evidence.origin === row.origin &&
    sameOptionalUuid(evidence.importBatchId, row.importBatchId) &&
    evidence.editorId.toLowerCase() === row.editorId.toLowerCase() &&
    evidence.reviewerId.toLowerCase() === row.review.reviewerId.toLowerCase() &&
    evidence.reviewedAt === row.review.reviewedAt &&
    Date.parse(evidence.reviewedAt) >= Date.parse(row.editedAt) &&
    Date.parse(evidence.reviewedAt) <= Date.parse(evaluatedAt);
  if (!evidenceMatches) {
    issues.push(publicationIssue("TRANSLATION_APPROVAL_MISMATCH", path));
  }
}

export function validateTranslationPackage<
  Row extends ApprovableTranslationRow,
>(input: {
  objectKind: ApprovalObjectKind;
  parentRevisionId: string;
  rows: readonly Row[];
  approvals: readonly TranslationApprovalEvidence[];
  computeContentHash: (row: Row) => string;
  parentRevisionIdOf: (row: Row) => string;
  evaluatedAt: string;
  issues: PublicationValidationIssue[];
  pathPrefix: SafePath;
}): string | undefined {
  const rowsByLocale = new Map<string, Row[]>();
  for (const row of input.rows) {
    const matches = rowsByLocale.get(row.locale) ?? [];
    matches.push(row);
    rowsByLocale.set(row.locale, matches);
  }

  for (const locale of SUPPORTED_LOCALES) {
    const matches = rowsByLocale.get(locale) ?? [];
    if (matches.length === 0) {
      input.issues.push(
        publicationIssue("TRANSLATION_MISSING", [...input.pathPrefix, locale]),
      );
    } else if (matches.length > 1) {
      input.issues.push(
        publicationIssue("TRANSLATION_DUPLICATE", [
          ...input.pathPrefix,
          locale,
        ]),
      );
    }
  }

  const englishRows = rowsByLocale.get("en") ?? [];
  const english = englishRows.length === 1 ? englishRows[0] : undefined;
  if (
    english !== undefined &&
    english.sourceHash !== english.translatedFromSourceHash
  ) {
    input.issues.push(
      publicationIssue("ENGLISH_SOURCE_INVALID", [...input.pathPrefix, "en"]),
    );
  }

  for (const [index, row] of input.rows.entries()) {
    if (
      canonicalUuid(input.parentRevisionIdOf(row)) !==
      canonicalUuid(input.parentRevisionId)
    ) {
      input.issues.push(
        publicationIssue("TRANSLATION_PARENT_MISMATCH", [
          ...input.pathPrefix,
          index,
        ]),
      );
    }
    if (input.computeContentHash(row) !== row.sourceHash) {
      input.issues.push(
        publicationIssue("TRANSLATION_CONTENT_HASH_MISMATCH", [
          ...input.pathPrefix,
          index,
          "sourceHash",
        ]),
      );
    }
    if (
      english !== undefined &&
      row.translatedFromSourceHash !== english.sourceHash
    ) {
      input.issues.push(
        publicationIssue("TRANSLATION_STALE", [...input.pathPrefix, index]),
      );
    } else if (row.review.status !== "APPROVED") {
      input.issues.push(
        publicationIssue("TRANSLATION_NOT_APPROVED", [
          ...input.pathPrefix,
          index,
          "review",
        ]),
      );
    }
    validateApproval(
      row,
      index,
      input.objectKind,
      input.parentRevisionId,
      input.approvals,
      input.evaluatedAt,
      input.pathPrefix,
      input.issues,
    );
  }
  return english?.sourceHash;
}
