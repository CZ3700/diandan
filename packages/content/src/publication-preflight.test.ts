import { withoutFields } from "./publication-preflight-shared.js";
import { expect, test } from "vitest";
import { publicationPreflightFixture } from "./publication-preflight-fixtures.js";
import { evaluatePublicationPreflight } from "./publication-preflight.js";
import { withPreflightExtensions } from "./publication-preflight-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { contentAuthoringSnapshotSchema } from "@fan-support/contracts";
import {
  SUPPORTED_LOCALES,
  sourceHashSchema,
  type PublicationPreflightContext,
  type TranslationApprovalEvidence,
} from "@fan-support/contracts";
import { preflightFixtureId } from "./publication-preflight-fixtures.js";
import { computeBaseContentTextHash } from "./base-content.js";
import { baseContentTextSchema } from "@fan-support/contracts";

for (const kind of [
  "IDOL",
  "GIFT",
  "HOMEPAGE",
  "POLICY",
  "MEDIA_METADATA",
] as const)
  test(`${kind} fully approved DRAFT passes a read-only preflight`, () => {
    const context = publicationPreflightFixture(kind);
    const before = structuredClone(context);
    const result = evaluatePublicationPreflight(context);
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      ready: true,
      headVersion: 0,
      contentHash: context.snapshot.contentHash,
    });
    expect(context).toEqual(before);
  });
function codes(context: unknown): string[] {
  const response = evaluatePublicationPreflight(context);
  expect(response.outcome).toBe("SUCCESS");
  return response.outcome === "SUCCESS"
    ? response.issues.map((issue) => issue.code)
    : [];
}
for (const kind of ["IDOL", "GIFT"] as const) {
  test(`${kind} independent extension evidence is required`, () => {
    const context = withPreflightExtensions(publicationPreflightFixture(kind));
    context.extensionApprovals = [];
    expect(codes(context)).toContain("EXTENSION_REVIEW_MISSING");
  });
  test(`${kind} independently approved extension is ready`, () => {
    expect(
      evaluatePublicationPreflight(
        withPreflightExtensions(publicationPreflightFixture(kind)),
      ),
    ).toMatchObject({ ready: true });
  });
}
test("detail rows absent for a launch language cannot fall back to base description", () => {
  const context = withPreflightExtensions(publicationPreflightFixture("GIFT"));
  const details = context.snapshot.extensions.details!;
  details.translations = details.translations.filter(
    (row) => row.locale !== "ja",
  );
  if (context.snapshot.content.kind === "GIFT")
    context.snapshot.content.details!.translations =
      context.snapshot.content.details!.translations.filter(
        (row) => row.locale !== "ja",
      );
  context.snapshot = contentAuthoringSnapshotSchema.parse({
    ...context.snapshot,
    contentHash: computeContentAuthoringSnapshotHash(context.snapshot),
  });
  expect(codes(context)).toContain("EXTENSION_TRANSLATION_MISSING");
});
test("standalone media blocks revoked rights and missing derivatives", () => {
  const context = publicationPreflightFixture("MEDIA_METADATA");
  if (context.candidate.objectKind !== "MEDIA_METADATA") throw new Error();
  context.candidate.asset.rightsStatus = "REJECTED";
  context.candidate.variants = [];
  expect(codes(context)).toContain("MEDIA_RIGHTS_NOT_APPROVED");
  expect(codes(context)).toContain("MEDIA_DERIVATIVE_MISSING");
});
function sync(context: PublicationPreflightContext): void {
  const snapshot = context.snapshot;
  const candidate = context.candidate;
  if (candidate.objectKind !== "MEDIA_METADATA") {
    candidate.revision.lifecycle = snapshot.lifecycle;
    candidate.revision.createdBy = snapshot.createdBy;
    candidate.translations = candidate.translations.map((row) => {
      const audit = snapshot.translationAudits.find(
        (a) => a.locale === row.locale,
      )!;
      const text = snapshot.content.translations.find(
        (a) => a.locale === row.locale,
      )!;
      const rest = withoutFields(audit, [
        "reviewId",
        "reviewSequence",
        "inheritedFrom",
      ]);
      return { ...row, ...rest, ...text.fields };
    }) as typeof candidate.translations;
  }
  context.snapshot = contentAuthoringSnapshotSchema.parse({
    ...snapshot,
    contentHash: computeContentAuthoringSnapshotHash(snapshot),
  });
}
for (const kind of [
  "IDOL",
  "GIFT",
  "HOMEPAGE",
  "POLICY",
  "MEDIA_METADATA",
] as const)
  for (const locale of SUPPORTED_LOCALES) {
    test(`${kind}/${locale} unapproved row blocks`, () => {
      const context = publicationPreflightFixture(kind);
      const audit = context.snapshot.translationAudits.find(
        (row) => row.locale === locale,
      )!;
      audit.review = { status: "DRAFT" };
      audit.reviewSequence = 1;
      sync(context);
      expect(codes(context)).toContain("TRANSLATION_NOT_APPROVED");
    });
    test(`${kind}/${locale} approved flag without canonical review evidence blocks`, () => {
      const context = publicationPreflightFixture(kind);
      const id = context.snapshot.translationAudits.find(
        (row) => row.locale === locale,
      )!.id;
      context.approvals = context.approvals.filter(
        (proof) => proof.translationRevisionId !== id,
      );
      expect(codes(context)).toContain("TRANSLATION_APPROVAL_MISSING");
    });
    if (locale !== "en")
      test(`${kind}/${locale} English lineage stale blocks`, () => {
        const context = publicationPreflightFixture(kind);
        const audit = context.snapshot.translationAudits.find(
          (row) => row.locale === locale,
        )!;
        audit.translatedFromSourceHash = sourceHashSchema.parse("b".repeat(64));
        if (audit.review.status === "APPROVED")
          audit.review.reviewedSourceHash = audit.translatedFromSourceHash;
        sync(context);
        expect(codes(context)).toContain("TRANSLATION_STALE");
      });
  }
test("structure editor cannot borrow an independent translation review without copy proof", () => {
  const context = publicationPreflightFixture("POLICY");
  const audit = context.snapshot.translationAudits[0]!;
  if (audit.review.status !== "APPROVED") throw new Error();
  context.snapshot.createdBy = audit.review.reviewerId;
  sync(context);
  expect(codes(context)).toContain("REVIEW_SELF_APPROVAL");
});
test("source snapshot and legacy candidate cannot supply different content for the same revision", () => {
  const context = publicationPreflightFixture("POLICY");
  if (context.candidate.objectKind !== "POLICY") throw new Error();
  context.candidate.translations[0]!.title = "Another actual title";
  expect(codes(context)).toContain("CANONICAL_SNAPSHOT_MISMATCH");
});
test("approved review ID is bound even if all its other evidence matches", () => {
  const context = publicationPreflightFixture("POLICY");
  context.snapshot.translationAudits[0]!.reviewId = preflightFixtureId(1234);
  sync(context);
  expect(codes(context)).toContain("TRANSLATION_APPROVAL_MISMATCH");
});
test("approved review one microsecond after evaluation blocks", () => {
  const context = publicationPreflightFixture("POLICY");
  context.evaluatedAt = "2026-09-03T03:00:00.123456Z";
  if (context.candidate.objectKind !== "POLICY") throw new Error();
  context.candidate.evaluatedAt = context.evaluatedAt;
  const audit = context.snapshot.translationAudits[0]!;
  if (audit.review.status !== "APPROVED") throw new Error();
  audit.review.reviewedAt = "2026-09-03T03:00:00.123457Z";
  context.approvals.find(
    (p) => p.translationRevisionId === audit.id,
  )!.reviewedAt = audit.review.reviewedAt;
  sync(context);
  expect(codes(context)).toContain("TRANSLATION_APPROVAL_MISMATCH");
});
function copyFixture(): PublicationPreflightContext {
  const context = publicationPreflightFixture("POLICY");
  const audit = context.snapshot.translationAudits.find(
    (a) => a.locale === "ja",
  )!;
  const sourceAudit = structuredClone(audit);
  sourceAudit.id = preflightFixtureId(1300);
  sourceAudit.reviewId = preflightFixtureId(1301);
  const sourceRevisionId = preflightFixtureId(1302);
  audit.inheritedFrom = {
    revisionId: sourceRevisionId,
    translationId: sourceAudit.id,
    reviewId: sourceAudit.reviewId,
  };
  const target = { ...context.target, locale: audit.locale };
  const sourceApproval = structuredClone(
    context.approvals.find((p) => p.translationRevisionId === audit.id)!,
  ) as Extract<TranslationApprovalEvidence, { objectKind: "POLICY" }>;
  sourceApproval.translationRevisionId =
    sourceAudit.id as typeof sourceApproval.translationRevisionId;
  sourceApproval.approvalId =
    sourceAudit.reviewId as typeof sourceApproval.approvalId;
  sourceApproval.policyRevisionId =
    sourceRevisionId as typeof sourceApproval.policyRevisionId;
  context.copies = [
    {
      target,
      targetTranslationId: audit.id,
      targetReviewId: audit.reviewId,
      authoringReceiptId: preflightFixtureId(1303),
      source: {
        target: { ...target, revisionId: sourceRevisionId },
        text: baseContentTextSchema.parse({
          kind: "POLICY",
          fields: context.snapshot.content.translations.find(
            (t) => t.locale === "ja",
          )!.fields,
        }),
        audit: sourceAudit,
      },
      sourceApproval,
    },
  ];
  sync(context);
  return context;
}
test("unchanged reviewed copy requires and accepts the exact dedicated source edge", () => {
  const context = copyFixture();
  expect(evaluatePublicationPreflight(context)).toMatchObject({ ready: true });
  context.copies = [];
  expect(codes(context)).toContain("REVIEW_COPY_PROOF_MISSING");
});
test("copy proof cannot substitute a different source approved review", () => {
  const context = copyFixture();
  context.copies[0]!.sourceApproval.approvalId = preflightFixtureId(
    1400,
  ) as (typeof context.copies)[0]["sourceApproval"]["approvalId"];
  expect(codes(context)).toContain("REVIEW_COPY_PROOF_MISMATCH");
});
test("NFC-equivalent but raw-different copy text cannot inherit approval", () => {
  const context = copyFixture();
  const audit = context.snapshot.translationAudits.find(
    (a) => a.locale === "ja",
  )!;
  const text = context.snapshot.content.translations.find(
    (t) => t.locale === "ja",
  )!;
  if (context.snapshot.content.kind !== "POLICY" || !("title" in text.fields))
    throw new Error();
  text.fields.title = "Café";
  audit.sourceHash = sourceHashSchema.parse(
    computeBaseContentTextHash(
      baseContentTextSchema.parse({ kind: "POLICY", fields: text.fields }),
    ),
  );
  if (audit.review.status !== "APPROVED") throw new Error();
  audit.review.reviewedContentHash = audit.sourceHash;
  context.approvals.find(
    (p) => p.translationRevisionId === audit.id,
  )!.approvedContentHash = audit.sourceHash;
  const proof = context.copies[0]!;
  proof.source.text = baseContentTextSchema.parse({
    kind: "POLICY",
    fields: { ...text.fields, title: "Cafe\u0301" },
  });
  proof.source.audit.sourceHash = audit.sourceHash;
  if (proof.source.audit.review.status === "APPROVED")
    proof.source.audit.review.reviewedContentHash = audit.sourceHash;
  proof.sourceApproval.approvedContentHash = audit.sourceHash;
  sync(context);
  expect(codes(context)).toContain("REVIEW_COPY_PROOF_MISMATCH");
});
test("malformed ICU with a real matching content hash and approval remains blocked", () => {
  const context = publicationPreflightFixture("POLICY");
  const row = context.snapshot.content.translations.find(
    (t) => t.locale === "ja",
  )!;
  if (!("title" in row.fields)) throw new Error();
  row.fields.title = "Invalid {name";
  const audit = context.snapshot.translationAudits.find(
    (t) => t.locale === "ja",
  )!;
  audit.sourceHash = sourceHashSchema.parse(
    computeBaseContentTextHash(
      baseContentTextSchema.parse({ kind: "POLICY", fields: row.fields }),
    ),
  );
  if (audit.review.status === "APPROVED")
    audit.review.reviewedContentHash = audit.sourceHash;
  context.approvals.find(
    (p) => p.translationRevisionId === audit.id,
  )!.approvedContentHash = audit.sourceHash;
  sync(context);
  expect(codes(context)).toContain("TRANSLATION_ICU_INVALID");
});
function rollbackFixture(): PublicationPreflightContext {
  const context = publicationPreflightFixture("POLICY");
  if (context.candidate.objectKind !== "POLICY") throw new Error();
  context.action = "ROLLBACK";
  context.candidate.action = "ROLLBACK";
  context.headVersion = 2;
  context.snapshot.lifecycle = {
    status: "SUPERSEDED",
    validatedAt: "2026-09-03T02:00:00Z",
    publishedAt: "2026-09-03T02:30:00Z",
    supersededAt: "2026-09-03T02:45:00Z",
  };
  context.candidate.currentPublishedRevisionId = preflightFixtureId(
    1500,
  ) as typeof context.candidate.currentPublishedRevisionId;
  context.candidate.currentPublication = {
    schemaVersion: 1,
    id: preflightFixtureId(1501) as NonNullable<
      typeof context.candidate.currentPublication
    >["id"],
    objectKind: "POLICY",
    action: "PUBLISH",
    policyKey: context.candidate.revision.policyKey,
    targetRevisionId: context.candidate.currentPublishedRevisionId!,
  };
  context.previousPublication = {
    publicationId: preflightFixtureId(1502),
    target: context.target,
    action: "PUBLISH",
    publishedAt: "2026-09-03T02:30:00Z",
  };
  sync(context);
  return context;
}
test("rollback requires exact historical publication, superseded lifecycle and a different current head", () => {
  const context = rollbackFixture();
  expect(evaluatePublicationPreflight(context)).toMatchObject({ ready: true });
  context.previousPublication = null;
  expect(codes(context)).toContain("ROLLBACK_TARGET_INVALID");
});
test("rollback cannot borrow another owner publication or a future historical event", () => {
  const context = rollbackFixture();
  context.previousPublication!.target = {
    ...context.target,
    owner: { kind: "POLICY", policyKey: "another-policy" },
  };
  expect(codes(context)).toContain("ROLLBACK_TARGET_INVALID");
  context.previousPublication!.target = context.target;
  context.previousPublication!.publishedAt = "2026-09-03T03:00:00.000001Z";
  expect(codes(context)).toContain("ROLLBACK_TARGET_INVALID");
});
test("publish on a superseded revision is blocked even if old reviews remain valid", () => {
  const context = rollbackFixture();
  context.action = "PUBLISH";
  if (context.candidate.objectKind === "POLICY")
    context.candidate.action = "PUBLISH";
  expect(codes(context)).toContain("REVISION_NOT_VALIDATED");
});
test("publication head sequence cannot be confused with authoring revision sequence", () => {
  const context = publicationPreflightFixture("POLICY");
  context.headVersion = 1;
  expect(codes(context)).toContain("CANONICAL_SNAPSHOT_MISMATCH");
});
for (const kind of [
  "IDOL",
  "GIFT",
  "HOMEPAGE",
  "POLICY",
  "MEDIA_METADATA",
] as const)
  test(`${kind} missing launch language blocks complete revision`, () => {
    const context = publicationPreflightFixture(kind);
    context.snapshot.translationAudits =
      context.snapshot.translationAudits.filter((a) => a.locale !== "ja");
    context.snapshot.content.translations =
      context.snapshot.content.translations.filter(
        (a) => a.locale !== "ja",
      ) as typeof context.snapshot.content.translations;
    if (context.candidate.objectKind !== "MEDIA_METADATA")
      context.candidate.translations = context.candidate.translations.filter(
        (a) => a.locale !== "ja",
      ) as typeof context.candidate.translations;
    sync(context);
    expect(codes(context)).toContain("TRANSLATION_MISSING");
  });
test("detail review must be independent from document structure author as well as translator", () => {
  const context = withPreflightExtensions(publicationPreflightFixture("GIFT"));
  context.extensionApprovals[0]!.structureEditorId =
    context.extensionApprovals[0]!.reviewerId;
  expect(codes(context)).toContain("REVIEW_SELF_APPROVAL");
});
test("alias review cannot borrow a prior set or alter microsecond evidence", () => {
  const context = withPreflightExtensions(publicationPreflightFixture("IDOL"));
  context.extensionApprovals[0]!.reviewedAt = "2026-09-03T02:15:00.000001Z";
  expect(codes(context)).toContain("EXTENSION_REVIEW_MISMATCH");
  context.extensionApprovals[0]!.subjectId = preflightFixtureId(1600);
  expect(codes(context)).toContain("EXTENSION_REVIEW_MISSING");
});
test("gift price, stock association and eligible idols remain required", () => {
  const context = publicationPreflightFixture("GIFT");
  if (context.candidate.objectKind !== "GIFT") throw new Error();
  context.candidate.prices = [];
  context.candidate.inventoryItems = [];
  context.candidate.eligibleIdols = [];
  const result = evaluatePublicationPreflight(context);
  expect(result).toMatchObject({ outcome: "SUCCESS", ready: false });
  expect(codes(context)).toEqual(
    expect.arrayContaining(["PRICE_MISSING", "INVENTORY_ITEM_MISSING"]),
  );
});
test("policy effective time preserves a one-microsecond future boundary", () => {
  const context = publicationPreflightFixture("POLICY");
  if (
    context.candidate.objectKind !== "POLICY" ||
    context.snapshot.content.kind !== "POLICY"
  )
    throw new Error();
  context.candidate.revision.effectiveAt = "2026-09-03T03:00:00.000001Z";
  context.snapshot.content.structure.effectiveAt =
    context.candidate.revision.effectiveAt;
  sync(context);
  expect(codes(context)).toContain("POLICY_NOT_EFFECTIVE");
});
test("price validity starts one microsecond after evaluation and remains unavailable", () => {
  const context = publicationPreflightFixture("GIFT");
  if (context.candidate.objectKind !== "GIFT") throw new Error();
  context.candidate.prices[0]!.validFrom = "2026-09-03T03:00:00.000001Z";
  expect(codes(context)).toContain("PRICE_NOT_EFFECTIVE");
});
test("price validity end is exclusive at full precision, without truncating a still-effective interval", () => {
  const context = publicationPreflightFixture("GIFT");
  if (context.candidate.objectKind !== "GIFT") throw new Error();
  context.candidate.prices[0]!.validUntil = "2026-09-03T03:00:00.000001Z";
  expect(evaluatePublicationPreflight(context)).toMatchObject({ ready: true });
  context.evaluatedAt = "2026-09-03T03:00:00.000001Z";
  context.candidate.evaluatedAt = context.evaluatedAt;
  expect(codes(context)).toContain("PRICE_NOT_EFFECTIVE");
});
test("legacy diagnostics receive canonical locale labels for operational feedback", () => {
  const context = publicationPreflightFixture("POLICY");
  const audit = context.snapshot.translationAudits.find(
    (a) => a.locale === "ja",
  )!;
  audit.review = { status: "DRAFT" };
  audit.reviewSequence = 1;
  sync(context);
  const result = evaluatePublicationPreflight(context);
  expect(result).toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({
        code: "TRANSLATION_NOT_APPROVED",
        locale: "ja",
      }),
    ]),
  });
});
test("locale labels follow canonical rows even when candidate order differs from snapshot order", () => {
  const context = publicationPreflightFixture("POLICY");
  const audit = context.snapshot.translationAudits.find(
    (a) => a.locale === "ja",
  )!;
  audit.review = { status: "DRAFT" };
  audit.reviewSequence = 1;
  sync(context);
  if (context.candidate.objectKind !== "POLICY") throw new Error();
  context.candidate.translations.reverse();
  const response = evaluatePublicationPreflight(context);
  expect(response.outcome).toBe("SUCCESS");
  if (response.outcome === "SUCCESS")
    expect(
      response.issues
        .filter((issue) => issue.code === "TRANSLATION_NOT_APPROVED")
        .every((issue) => issue.locale === "ja"),
    ).toBe(true);
});
