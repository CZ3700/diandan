import { expect, test } from "vitest";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";

import { fictionalContentModelFixture } from "./model-fixtures.js";

type Issue = Readonly<{ code: string; severity: "BLOCKER" | "WARNING" }>;
type Report = Readonly<{
  objectKind: "IDOL" | "HOMEPAGE" | "POLICY";
  publishable: boolean;
  issues: readonly Issue[];
}>;
type Validator = (input: unknown, approvals: unknown) => Report;
type Implementation = Readonly<{
  validateHomepagePublicationCandidate: Validator;
  validateIdolPublicationCandidate: Validator;
  validatePolicyPublicationCandidate: Validator;
}>;
type Schema = Readonly<{
  safeParse: (input: unknown) => Readonly<{ success: boolean }>;
}>;
type ContractModule = Readonly<Record<string, unknown>>;

type TranslationRow = Readonly<{
  id: string;
  locale: string;
  sourceHash: string;
  translatedFromSourceHash: string;
  origin: "HUMAN" | "MACHINE" | "IMPORT";
  importBatchId?: string | undefined;
  editorId: string;
  editedAt: string;
  review:
    | Readonly<{ status: "DRAFT" }>
    | Readonly<{ status: "IN_REVIEW"; submittedAt: string }>
    | Readonly<{
        status: "APPROVED";
        reviewerId: string;
        reviewedAt: string;
      }>;
}>;

type MediaTranslationRow = TranslationRow &
  Readonly<{ mediaMetadataRevisionId: string }>;

const WRONG_REVISION_ID = "f7b914ca-2961-4389-a11b-36df4970d03f";

async function loadImplementation(): Promise<Implementation> {
  const implementation = await import("./non-gift-publication.js").catch(
    () => undefined,
  );
  expect(
    implementation,
    "non-Gift publication validators must exist",
  ).toBeDefined();
  return implementation as unknown as Implementation;
}

async function loadContracts(): Promise<ContractModule> {
  return (await import("@fan-support/contracts")) as ContractModule;
}

function fixtureUuid(sequence: number): string {
  return `10000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function approvalsFor(
  objectKind: "IDOL" | "HOMEPAGE" | "POLICY",
  parentRevisionId: string,
  rows: readonly TranslationRow[],
): readonly Record<string, unknown>[] {
  const reviewedFieldPaths =
    objectKind === "IDOL"
      ? ["displayName", "shortBio", "fullBio", "seoTitle", "seoDescription"]
      : objectKind === "HOMEPAGE"
        ? [
            "heroTitle",
            "heroSubtitle",
            "ctaLabel",
            "announcement",
            "slotLabels",
            "seoTitle",
            "seoDescription",
          ]
        : ["title", "summary", "body"];
  return rows.map((row, index) => {
    if (row.review.status !== "APPROVED") {
      throw new Error("fixture translations must begin approved");
    }
    const parent =
      objectKind === "IDOL"
        ? { idolRevisionId: parentRevisionId }
        : objectKind === "HOMEPAGE"
          ? { homepageRevisionId: parentRevisionId }
          : { policyRevisionId: parentRevisionId };
    return {
      schemaVersion: 1,
      approvalId: fixtureUuid(index + 1),
      objectKind,
      translationRevisionId: row.id,
      ...parent,
      locale: row.locale,
      approvedSourceHash: row.translatedFromSourceHash,
      approvedContentHash: row.sourceHash,
      origin: row.origin,
      importBatchId: row.importBatchId,
      editorId: row.editorId,
      reviewerId: row.review.reviewerId,
      reviewedFieldPaths,
      reviewedAt: row.review.reviewedAt,
    };
  });
}

function mediaApprovalsFor(
  rows: readonly MediaTranslationRow[],
): readonly Record<string, unknown>[] {
  return rows.map((row, index) => {
    if (row.review.status !== "APPROVED") {
      throw new Error("fixture media translations must begin approved");
    }
    return {
      schemaVersion: 1,
      approvalId: fixtureUuid(100 + index),
      objectKind: "MEDIA_METADATA",
      translationRevisionId: row.id,
      mediaMetadataRevisionId: row.mediaMetadataRevisionId,
      locale: row.locale,
      approvedSourceHash: row.translatedFromSourceHash,
      approvedContentHash: row.sourceHash,
      origin: row.origin,
      importBatchId: row.importBatchId,
      editorId: row.editorId,
      reviewerId: row.review.reviewerId,
      reviewedFieldPaths: ["alt", "title", "caption"],
      reviewedAt: row.review.reviewedAt,
    };
  });
}

function manifestEntryFromApproval(
  publicationId: string,
  approval: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const manifestFields = Object.fromEntries(
    Object.entries(approval).filter(
      ([key]) =>
        ![
          "editorId",
          "reviewerId",
          "reviewedAt",
          "reviewedFieldPaths",
        ].includes(key),
    ),
  );
  return { ...manifestFields, publicationId };
}

function validIdolCandidate() {
  const fixture = fictionalContentModelFixture.idol;
  return {
    schemaVersion: 1,
    objectKind: "IDOL" as const,
    action: "PUBLISH" as const,
    currentPublication: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
    targetOperationalStatus: "active" as const,
    targetAcceptingGifts: true,
    base: {
      ...fixture.base,
      status: "draft" as const,
      acceptingGifts: false,
      draftRevisionId: fixture.revision.id,
      publishedRevisionId: null,
    },
    revision: {
      ...fixture.revision,
      lifecycle: {
        status: "VALIDATED" as const,
        validatedAt: "2026-09-03T02:30:00Z",
      },
    },
    translations: fixture.translations.map((row) => ({ ...row })),
    mediaReferences: fixture.media.map((reference) => ({ ...reference })),
    mediaAssets: fixture.assets.map((asset) => ({ ...asset })),
    mediaVariants: fixture.variants.map((variant) => ({ ...variant })),
    mediaMetadataRevisions: fixture.metadataRevisions.map((revision) => ({
      ...revision,
    })),
    mediaTranslations: fixture.mediaTranslations.map((row) => ({ ...row })),
  };
}

function validHomepageCandidate() {
  const fixture = fictionalContentModelFixture.homepage;
  const heroSlot = fixture.slots.find((slot) => slot.kind === "HERO_IDOL");
  if (heroSlot === undefined) {
    throw new Error("fixture homepage must contain one hero slot");
  }
  const heroAssetIds = new Set([
    heroSlot.desktopMediaAssetId,
    heroSlot.mobileMediaAssetId,
  ]);
  const heroMetadataRevisionIds = new Set([
    heroSlot.desktopMediaMetadataRevisionId,
    heroSlot.mobileMediaMetadataRevisionId,
  ]);
  return {
    schemaVersion: 1,
    objectKind: "HOMEPAGE" as const,
    action: "PUBLISH" as const,
    currentPublication: null,
    currentPublishedRevisionId: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
    revision: {
      ...fixture.revision,
      lifecycle: {
        status: "VALIDATED" as const,
        validatedAt: "2026-09-03T02:30:00Z",
      },
    },
    translations: fixture.translations.map((row) => ({ ...row })),
    slots: fixture.slots.map((slot) => ({ ...slot })),
    referencedIdols: [{ ...fictionalContentModelFixture.idol.base }],
    referencedGifts: [],
    referencedPolicies: [],
    mediaAssets: fictionalContentModelFixture.idol.assets
      .filter((asset) => heroAssetIds.has(asset.id))
      .map((asset) => ({ ...asset })),
    mediaVariants: fictionalContentModelFixture.idol.variants
      .filter((variant) => heroAssetIds.has(variant.mediaAssetId))
      .map((variant) => ({ ...variant })),
    mediaMetadataRevisions: fictionalContentModelFixture.idol.metadataRevisions
      .filter((revision) => heroMetadataRevisionIds.has(revision.id))
      .map((revision) => ({ ...revision })),
    mediaTranslations: fictionalContentModelFixture.idol.mediaTranslations
      .filter((row) => heroMetadataRevisionIds.has(row.mediaMetadataRevisionId))
      .map((row) => ({ ...row })),
  };
}

function validPolicyCandidate() {
  const fixture = fictionalContentModelFixture.policy;
  return {
    schemaVersion: 1,
    objectKind: "POLICY" as const,
    action: "PUBLISH" as const,
    currentPublication: null,
    currentPublishedRevisionId: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
    revision: {
      ...fixture.revision,
      lifecycle: {
        status: "VALIDATED" as const,
        validatedAt: "2026-09-03T02:30:00Z",
      },
    },
    translations: fixture.translations.map((row) => ({ ...row })),
  };
}

function approvalSetForCandidate(candidate: {
  readonly objectKind: "IDOL" | "HOMEPAGE" | "POLICY";
  readonly revision: Readonly<{ id: string }>;
  readonly translations: readonly TranslationRow[];
  readonly mediaTranslations?: readonly MediaTranslationRow[];
}) {
  return [
    ...approvalsFor(
      candidate.objectKind,
      candidate.revision.id,
      candidate.translations,
    ),
    ...mediaApprovalsFor(candidate.mediaTranslations ?? []),
  ];
}

function blockerCodes(report: Report): ReadonlySet<string> {
  return new Set(
    report.issues
      .filter((issue) => issue.severity === "BLOCKER")
      .map((issue) => issue.code),
  );
}

test("defines strict discriminated candidates, trusted approvals, selections, and publication action semantics", async () => {
  const contracts = await loadContracts();
  const requiredSchemas = [
    "translationApprovalEvidenceSchema",
    "idolPublicationCandidateSchema",
    "homepagePublicationCandidateSchema",
    "policyPublicationCandidateSchema",
    "contentPublicationCandidateSchema",
    "publicRevisionSelectionSchema",
  ] as const;
  for (const name of requiredSchemas) {
    expect(contracts[name], `${name} must be exported`).toBeDefined();
  }

  const approvalSchema = contracts[
    "translationApprovalEvidenceSchema"
  ] as Schema;
  const idolCandidateSchema = contracts[
    "idolPublicationCandidateSchema"
  ] as Schema;
  const idol = validIdolCandidate();
  const approval = approvalSetForCandidate(idol)[0]!;
  expect(approvalSchema.safeParse(approval).success).toBe(true);
  expect(
    approvalSchema.safeParse({
      ...approval,
      reviewerId: approval["editorId"],
    }).success,
  ).toBe(false);
  expect(
    approvalSchema.safeParse({
      ...approval,
      reviewerId: String(approval["editorId"]).toUpperCase(),
    }).success,
  ).toBe(false);
  expect(
    approvalSchema.safeParse({ ...approval, untrusted: true }).success,
  ).toBe(false);
  expect(
    approvalSchema.safeParse({
      ...approval,
      reviewedFieldPaths: ["displayName", "displayName"],
    }).success,
  ).toBe(false);
  const approvalWithoutFields: Record<string, unknown> = { ...approval };
  delete approvalWithoutFields["reviewedFieldPaths"];
  expect(approvalSchema.safeParse(approvalWithoutFields).success).toBe(false);
  expect(idolCandidateSchema.safeParse(idol).success).toBe(true);
  expect(
    idolCandidateSchema.safeParse({ ...idol, approvals: [] }).success,
  ).toBe(false);

  const publicationSchema = contracts["contentPublicationSchema"] as Schema;
  const basePublication = {
    schemaVersion: 1,
    id: "65ea8b40-496c-4f85-b1e5-11572acb6689",
    objectKind: "IDOL",
    idolId: idol.base.id,
    idolRevisionId: idol.revision.id,
    mediaMetadataRevisionIds: [
      ...new Set(
        idol.mediaReferences.map(
          (reference) => reference.mediaMetadataRevisionId,
        ),
      ),
    ],
    translationManifest: approvalSetForCandidate(idol).map((approval) =>
      manifestEntryFromApproval(
        "65ea8b40-496c-4f85-b1e5-11572acb6689",
        approval,
      ),
    ),
    publishedBy: "c64367a8-350a-4fa5-b866-17ceeea511e0",
    publishedAt: "2026-09-03T03:00:00Z",
  };
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
    }).success,
  ).toBe(true);
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "ROLLBACK",
      replacesPublicationId: null,
    }).success,
  ).toBe(false);

  const firstMediaMetadataRevisionId =
    basePublication.mediaMetadataRevisionIds[0]!;
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      translationManifest: basePublication.translationManifest.filter(
        (entry) =>
          entry["objectKind"] !== "MEDIA_METADATA" ||
          entry["mediaMetadataRevisionId"] !== firstMediaMetadataRevisionId,
      ),
    }).success,
  ).toBe(false);
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      mediaMetadataRevisionIds: [],
      translationManifest: basePublication.translationManifest.filter(
        (entry) => entry["objectKind"] !== "MEDIA_METADATA",
      ),
    }).success,
  ).toBe(false);
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      mediaMetadataRevisionIds: [
        ...basePublication.mediaMetadataRevisionIds,
        firstMediaMetadataRevisionId,
      ],
    }).success,
  ).toBe(false);
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "ROLLBACK",
      replacesPublicationId: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
    }).success,
  ).toBe(true);
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: basePublication.id,
    }).success,
  ).toBe(false);

  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      translationManifest: basePublication.translationManifest.map(
        (entry, index) =>
          index === 0
            ? {
                ...entry,
                publicationId: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
              }
            : entry,
      ),
    }).success,
  ).toBe(false);

  const staleMainManifest = basePublication.translationManifest.map((entry) =>
    entry["objectKind"] === "IDOL" && entry["locale"] === "zh-CN"
      ? { ...entry, approvedSourceHash: "f".repeat(64) }
      : entry,
  );
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      translationManifest: staleMainManifest,
    }).success,
  ).toBe(false);

  const staleMediaManifest = basePublication.translationManifest.map((entry) =>
    entry["objectKind"] === "MEDIA_METADATA" && entry["locale"] === "zh-CN"
      ? { ...entry, approvedSourceHash: "f".repeat(64) }
      : entry,
  );
  expect(
    publicationSchema.safeParse({
      ...basePublication,
      action: "PUBLISH",
      replacesPublicationId: null,
      translationManifest: staleMediaManifest,
    }).success,
  ).toBe(false);

  const selectionSchema = contracts["publicRevisionSelectionSchema"] as Schema;
  const englishManifest = basePublication.translationManifest.find(
    (entry) => entry["objectKind"] === "IDOL" && entry["locale"] === "en",
  );
  const englishMediaManifest = basePublication.translationManifest.filter(
    (entry) =>
      entry["objectKind"] === "MEDIA_METADATA" && entry["locale"] === "en",
  );
  expect(
    selectionSchema.safeParse({
      schemaVersion: 1,
      objectKind: "IDOL",
      idolId: idol.base.id,
      operationalStatus: "active",
      acceptingGifts: true,
      publishedRevisionId: idol.revision.id,
      selectedRevisionId: idol.revision.id,
      selectedTranslation: englishManifest,
      selectedMediaTranslations: englishMediaManifest,
      selectedRevisionLifecycle: "PUBLISHED",
      currentPublication: {
        ...basePublication,
        action: "PUBLISH",
        replacesPublicationId: null,
      },
    }).success,
  ).toBe(true);
});

test("accepts complete Idol, Homepage, and Policy publication candidates", async () => {
  const implementation = await loadImplementation();
  const cases = [
    [
      validIdolCandidate(),
      implementation.validateIdolPublicationCandidate,
      "IDOL",
    ],
    [
      validHomepageCandidate(),
      implementation.validateHomepagePublicationCandidate,
      "HOMEPAGE",
    ],
    [
      validPolicyCandidate(),
      implementation.validatePolicyPublicationCandidate,
      "POLICY",
    ],
  ] as const;

  for (const [candidate, validate, objectKind] of cases) {
    const report = validate(candidate, approvalSetForCandidate(candidate));
    expect(report.objectKind).toBe(objectKind);
    expect(report.publishable).toBe(true);
    expect(blockerCodes(report)).toEqual(new Set());
  }
});

test("requires exact, fresh, parent-bound, content-bound, independently approved seven-locale packages", async () => {
  const implementation = await loadImplementation();
  const cases = [
    [validIdolCandidate(), implementation.validateIdolPublicationCandidate],
    [
      validHomepageCandidate(),
      implementation.validateHomepagePublicationCandidate,
    ],
    [validPolicyCandidate(), implementation.validatePolicyPublicationCandidate],
  ] as const;

  for (const [candidate, validate] of cases) {
    const approvals = approvalSetForCandidate(candidate);

    const missing = {
      ...candidate,
      translations: candidate.translations.filter((row) => row.locale !== "th"),
    };
    expect(blockerCodes(validate(missing, approvals))).toContain(
      "TRANSLATION_MISSING",
    );

    const wrongParent = structuredClone(candidate);
    const parentField =
      candidate.objectKind === "IDOL"
        ? "idolRevisionId"
        : candidate.objectKind === "HOMEPAGE"
          ? "homepageRevisionId"
          : "policyRevisionId";
    wrongParent.translations[0] = {
      ...wrongParent.translations[0]!,
      [parentField]: WRONG_REVISION_ID,
    };
    expect(blockerCodes(validate(wrongParent, approvals))).toContain(
      "TRANSLATION_PARENT_MISMATCH",
    );

    const edited = structuredClone(candidate);
    const contentField =
      candidate.objectKind === "IDOL"
        ? "displayName"
        : candidate.objectKind === "HOMEPAGE"
          ? "heroTitle"
          : "body";
    const editedRow = edited.translations[0]! as unknown as Record<
      string,
      unknown
    >;
    editedRow[contentField] = `${String(editedRow[contentField])}!`;
    expect(blockerCodes(validate(edited, approvals))).toContain(
      "TRANSLATION_CONTENT_HASH_MISMATCH",
    );

    const stale = structuredClone(candidate);
    const staleRow = stale.translations[1]!;
    const staleRecord = staleRow as unknown as Record<string, unknown>;
    staleRecord["translatedFromSourceHash"] = "f".repeat(64);
    if (staleRow.review.status === "APPROVED") {
      staleRecord["review"] = {
        ...staleRow.review,
        reviewedSourceHash: "f".repeat(64),
      };
    }
    expect(blockerCodes(validate(stale, approvals))).toContain(
      "TRANSLATION_STALE",
    );

    const draft = structuredClone(candidate);
    draft.translations[2] = {
      ...draft.translations[2]!,
      review: { status: "DRAFT" },
    };
    expect(blockerCodes(validate(draft, approvals))).toContain(
      "TRANSLATION_NOT_APPROVED",
    );

    const changedReview = structuredClone(candidate);
    const changedReviewRow = changedReview.translations[2]!;
    if (changedReviewRow.review.status !== "APPROVED") {
      throw new Error("fixture translation must begin approved");
    }
    changedReview.translations[2] = {
      ...changedReviewRow,
      review: {
        ...changedReviewRow.review,
        reviewerId: fixtureUuid(
          999,
        ) as typeof changedReviewRow.review.reviewerId,
      },
    };
    expect(blockerCodes(validate(changedReview, approvals))).toContain(
      "TRANSLATION_APPROVAL_MISMATCH",
    );

    const futureReview = structuredClone(candidate);
    const futureReviewRow = futureReview.translations[0]!;
    if (futureReviewRow.review.status !== "APPROVED") {
      throw new Error("fixture translation must begin approved");
    }
    futureReview.translations[0] = {
      ...futureReviewRow,
      review: {
        ...futureReviewRow.review,
        reviewedAt: "2026-09-04T00:00:00Z",
      },
    };
    const futureApproval = approvals.map((approval, index) =>
      index === 0
        ? { ...approval, reviewedAt: "2026-09-04T00:00:00Z" }
        : approval,
    );
    expect(blockerCodes(validate(futureReview, futureApproval))).toContain(
      "TRANSLATION_APPROVAL_MISMATCH",
    );

    const machineApproved = structuredClone(candidate);
    machineApproved.translations[3] = {
      ...machineApproved.translations[3]!,
      origin: "MACHINE",
    };
    const machineApprovals = approvals.map((approval) =>
      approval["translationRevisionId"] === machineApproved.translations[3]?.id
        ? { ...approval, origin: "MACHINE" }
        : approval,
    );
    expect(validate(machineApproved, machineApprovals).publishable).toBe(true);

    expect(blockerCodes(validate(candidate, approvals.slice(1)))).toContain(
      "TRANSLATION_APPROVAL_MISSING",
    );
    expect(
      blockerCodes(validate(candidate, [...approvals, approvals[0]!])),
    ).toContain("TRANSLATION_APPROVAL_DUPLICATE");
    const mismatchedApproval = approvals.map((approval, index) =>
      index === 0
        ? { ...approval, approvedContentHash: "e".repeat(64) }
        : approval,
    );
    expect(blockerCodes(validate(candidate, mismatchedApproval))).toContain(
      "TRANSLATION_APPROVAL_MISMATCH",
    );
  }
});

test("enforces Idol lifecycle, draft pointer, and exactly one required media reference per role", async () => {
  const { validateIdolPublicationCandidate } = await loadImplementation();
  const candidate = validIdolCandidate();
  const approvals = approvalSetForCandidate(candidate);

  const wrongPointer = {
    ...candidate,
    base: { ...candidate.base, draftRevisionId: null },
  };
  expect(
    blockerCodes(validateIdolPublicationCandidate(wrongPointer, approvals)),
  ).toContain("DRAFT_POINTER_MISMATCH");

  const pausedButAccepting = {
    ...candidate,
    targetOperationalStatus: "paused" as const,
    targetAcceptingGifts: true,
  };
  expect(
    blockerCodes(
      validateIdolPublicationCandidate(pausedButAccepting, approvals),
    ),
  ).toContain("TARGET_OPERATIONAL_STATE_INVALID");

  const futureLifecycle = {
    ...candidate,
    revision: {
      ...candidate.revision,
      lifecycle: {
        status: "VALIDATED" as const,
        validatedAt: "2026-09-04T00:00:00Z",
      },
    },
  };
  expect(
    blockerCodes(validateIdolPublicationCandidate(futureLifecycle, approvals)),
  ).toContain("REVISION_LIFECYCLE_TIME_INVALID");

  const missingHero = {
    ...candidate,
    mediaReferences: candidate.mediaReferences.filter(
      (reference) => reference.role !== "HERO_MOBILE",
    ),
  };
  expect(
    blockerCodes(validateIdolPublicationCandidate(missingHero, approvals)),
  ).toContain("MEDIA_REQUIRED_ROLE_MISSING");

  const duplicatePortrait = {
    ...candidate,
    mediaReferences: [
      ...candidate.mediaReferences,
      { ...candidate.mediaReferences[0]!, sortOrder: 99 },
    ],
  };
  expect(
    blockerCodes(
      validateIdolPublicationCandidate(duplicatePortrait, approvals),
    ),
  ).toContain("MEDIA_REQUIRED_ROLE_DUPLICATE");

  const withoutMediaApprovals = approvals.filter(
    (approval) => approval["objectKind"] !== "MEDIA_METADATA",
  );
  expect(
    blockerCodes(
      validateIdolPublicationCandidate(candidate, withoutMediaApprovals),
    ),
  ).toContain("TRANSLATION_APPROVAL_MISSING");

  const emptyAlt = structuredClone(candidate);
  emptyAlt.mediaTranslations[0] = {
    ...emptyAlt.mediaTranslations[0]!,
    alt: "\u200B",
  };
  expect(
    blockerCodes(validateIdolPublicationCandidate(emptyAlt, approvals)),
  ).toContain("MEDIA_ALT_MISSING");

  const unrelatedMediaTranslation = structuredClone(candidate);
  unrelatedMediaTranslation.mediaTranslations[0] = {
    ...unrelatedMediaTranslation.mediaTranslations[0]!,
    mediaMetadataRevisionId:
      "08b04355-e1c7-46fb-8c98-f84445f68a65" as (typeof unrelatedMediaTranslation.mediaTranslations)[number]["mediaMetadataRevisionId"],
  };
  expect(
    blockerCodes(
      validateIdolPublicationCandidate(unrelatedMediaTranslation, approvals),
    ),
  ).toContain("TRANSLATION_PARENT_MISMATCH");
});

test("enforces Homepage slot ownership, uniqueness, one hero, labels, and published references", async () => {
  const { validateHomepagePublicationCandidate } = await loadImplementation();
  const candidate = validHomepageCandidate();
  const approvals = approvalSetForCandidate(candidate);

  const wrongParent = structuredClone(candidate);
  const wrongParentSlot = wrongParent.slots[0]! as unknown as Record<
    string,
    unknown
  >;
  wrongParentSlot["homepageRevisionId"] = WRONG_REVISION_ID;
  expect(
    blockerCodes(validateHomepagePublicationCandidate(wrongParent, approvals)),
  ).toContain("HOMEPAGE_SLOT_PARENT_MISMATCH");

  const duplicateSlot = {
    ...candidate,
    slots: [...candidate.slots, { ...candidate.slots[0]!, sortOrder: 1 }],
  };
  const duplicateCodes = blockerCodes(
    validateHomepagePublicationCandidate(duplicateSlot, approvals),
  );
  expect(duplicateCodes).toContain("HOMEPAGE_SLOT_DUPLICATE");
  expect(duplicateCodes).toContain("HOMEPAGE_HERO_INVALID");

  const duplicateSortOrder = {
    ...candidate,
    slots: [
      ...candidate.slots,
      {
        schemaVersion: 1 as const,
        homepageRevisionId: candidate.revision.id,
        slotKey: "another-featured-idol",
        kind: "FEATURED_IDOL" as const,
        idolId: candidate.referencedIdols[0]!.id,
        sortOrder: candidate.slots[0]!.sortOrder,
      },
    ],
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(duplicateSortOrder, approvals),
    ),
  ).toContain("HOMEPAGE_SLOT_DUPLICATE");

  const wrongLabels = structuredClone(candidate);
  wrongLabels.translations[0] = {
    ...wrongLabels.translations[0]!,
    slotLabels: [{ slotKey: "missing-slot", label: "Wrong" }],
  };
  expect(
    blockerCodes(validateHomepagePublicationCandidate(wrongLabels, approvals)),
  ).toContain("HOMEPAGE_SLOT_LABEL_MISMATCH");

  const invisibleHeroAlt = structuredClone(candidate);
  invisibleHeroAlt.mediaTranslations[0] = {
    ...invisibleHeroAlt.mediaTranslations[0]!,
    alt: "\u200B",
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(invisibleHeroAlt, approvals),
    ),
  ).toContain("MEDIA_ALT_MISSING");

  const unpublishedReference = {
    ...candidate,
    referencedIdols: candidate.referencedIdols.map((idol) => ({
      ...idol,
      publishedRevisionId: null,
    })),
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(unpublishedReference, approvals),
    ),
  ).toContain("HOMEPAGE_REFERENCE_NOT_PUBLIC");

  const missingHeroAsset = { ...candidate, mediaAssets: [] };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(missingHeroAsset, approvals),
    ),
  ).toContain("MEDIA_ASSET_MISSING");

  const heroSlot = candidate.slots.find((slot) => slot.kind === "HERO_IDOL")!;
  const missingMobileAsset = {
    ...candidate,
    mediaAssets: candidate.mediaAssets.filter(
      (asset) => asset.id !== heroSlot.mobileMediaAssetId,
    ),
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(missingMobileAsset, approvals),
    ),
  ).toContain("MEDIA_ASSET_MISSING");

  const sharedHeroAsset = structuredClone(candidate);
  const sharedHeroSlot = sharedHeroAsset.slots[0]! as unknown as Record<
    string,
    unknown
  >;
  sharedHeroSlot["mobileMediaAssetId"] = sharedHeroSlot["desktopMediaAssetId"];
  sharedHeroSlot["mobileMediaMetadataRevisionId"] =
    sharedHeroSlot["desktopMediaMetadataRevisionId"];
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(sharedHeroAsset, approvals),
    ),
  ).toContain("SCHEMA_INVALID");

  const duplicateVariantId = {
    ...candidate,
    mediaVariants: [
      ...candidate.mediaVariants,
      { ...candidate.mediaVariants[0]! },
    ],
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(duplicateVariantId, approvals),
    ),
  ).toContain("MEDIA_VARIANT_ID_DUPLICATE");

  const responsiveHero = {
    ...candidate,
    mediaVariants: [
      ...candidate.mediaVariants,
      {
        ...candidate.mediaVariants[0]!,
        id: "00000000-0000-4000-8000-000000008881",
        width: 1280,
        height: 720,
        status: "PROCESSING" as const,
      },
    ],
  };
  expect(
    validateHomepagePublicationCandidate(responsiveHero, approvals).publishable,
  ).toBe(true);

  const undersizedHeroDerivatives = {
    ...candidate,
    mediaVariants: candidate.mediaVariants.map((variant) => ({
      ...variant,
      width: 800,
      height: 450,
    })),
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(
        undersizedHeroDerivatives,
        approvals,
      ),
    ),
  ).toContain("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING");

  const duplicateDerivative = {
    ...candidate,
    mediaVariants: [
      ...candidate.mediaVariants,
      {
        ...candidate.mediaVariants[0]!,
        id: "00000000-0000-4000-8000-000000008882",
      },
    ],
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(duplicateDerivative, approvals),
    ),
  ).toContain("MEDIA_DERIVATIVE_DUPLICATE");

  const malformedProcessingDerivative = {
    ...candidate,
    mediaVariants: [
      ...candidate.mediaVariants,
      {
        ...candidate.mediaVariants[0]!,
        id: "00000000-0000-4000-8000-000000008883",
        width: 800,
        height: 800,
        status: "PROCESSING" as const,
      },
    ],
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(
        malformedProcessingDerivative,
        approvals,
      ),
    ),
  ).toContain("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID");

  const policySlot = {
    ...candidate,
    referencedPolicies: [],
    slots: [
      ...candidate.slots,
      {
        schemaVersion: 1 as const,
        homepageRevisionId: candidate.revision.id,
        slotKey: "refund-policy",
        kind: "POLICY_LINK" as const,
        policyKey: "fixture-refund-policy",
        sortOrder: 1,
      },
    ],
  };
  expect(
    blockerCodes(validateHomepagePublicationCandidate(policySlot, approvals)),
  ).toContain("HOMEPAGE_REFERENCE_NOT_PUBLIC");

  const publishedPolicyReference = {
    ...policySlot,
    referencedPolicies: [
      {
        schemaVersion: 1 as const,
        policyKey: "fixture-refund-policy",
        publishedRevisionId: fictionalContentModelFixture.policy.revision.id,
        selectedRevisionLifecycle: "PUBLISHED" as const,
        currentPublication: {
          schemaVersion: 1 as const,
          id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
          objectKind: "POLICY" as const,
          policyKey: "fixture-refund-policy",
          action: "PUBLISH" as const,
          targetRevisionId: fictionalContentModelFixture.policy.revision.id,
        },
      },
    ],
  };
  const homepageCandidateSchema = (await loadContracts())[
    "homepagePublicationCandidateSchema"
  ] as {
    safeParse: (input: unknown) =>
      | Readonly<{ success: true }>
      | Readonly<{
          success: false;
          error: Readonly<{ issues: readonly unknown[] }>;
        }>;
  };
  const publishedPolicyParse = homepageCandidateSchema.safeParse(
    publishedPolicyReference,
  );
  expect(
    publishedPolicyParse.success,
    publishedPolicyParse.success
      ? undefined
      : JSON.stringify(publishedPolicyParse.error.issues),
  ).toBe(true);
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(publishedPolicyReference, approvals),
    ),
  ).not.toContain("HOMEPAGE_REFERENCE_NOT_PUBLIC");
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(publishedPolicyReference, approvals),
    ),
  ).not.toContain("SCHEMA_INVALID");

  const relabeledPolicyPublication = {
    ...publishedPolicyReference,
    referencedPolicies: [
      {
        ...publishedPolicyReference.referencedPolicies[0]!,
        currentPublication: {
          ...publishedPolicyReference.referencedPolicies[0]!.currentPublication,
          policyKey: "relabeled-policy",
        },
      },
    ],
  };
  expect(
    blockerCodes(
      validateHomepagePublicationCandidate(
        relabeledPolicyPublication,
        approvals,
      ),
    ),
  ).toContain("SCHEMA_INVALID");
});

test("enforces Policy lifecycle and immediate effective time", async () => {
  const { validatePolicyPublicationCandidate } = await loadImplementation();
  const candidate = validPolicyCandidate();
  const approvals = approvalSetForCandidate(candidate);

  const draft = {
    ...candidate,
    revision: {
      ...candidate.revision,
      lifecycle: { status: "DRAFT" as const },
    },
  };
  expect(
    blockerCodes(validatePolicyPublicationCandidate(draft, approvals)),
  ).toContain("REVISION_NOT_VALIDATED");

  const future = {
    ...candidate,
    revision: {
      ...candidate.revision,
      effectiveAt: "2026-09-04T00:00:00Z",
    },
  };
  expect(
    blockerCodes(validatePolicyPublicationCandidate(future, approvals)),
  ).toContain("POLICY_NOT_EFFECTIVE");

  const beforeCreation = {
    ...candidate,
    revision: {
      ...candidate.revision,
      effectiveAt: "2026-08-31T23:59:59Z",
    },
  };
  expect(
    blockerCodes(validatePolicyPublicationCandidate(beforeCreation, approvals)),
  ).toContain("POLICY_EFFECTIVE_TIME_INVALID");
});

test("requires homepage and policy rollback candidates to reference immutable superseded revisions", async () => {
  const implementation = await loadImplementation();
  for (const [candidate, validate] of [
    [
      validHomepageCandidate(),
      implementation.validateHomepagePublicationCandidate,
    ],
    [validPolicyCandidate(), implementation.validatePolicyPublicationCandidate],
  ] as const) {
    const rollback = {
      ...candidate,
      action: "ROLLBACK" as const,
      currentPublication: null,
      currentPublishedRevisionId: WRONG_REVISION_ID,
      revision: {
        ...candidate.revision,
        lifecycle: {
          status: "SUPERSEDED" as const,
          validatedAt: "2026-09-03T01:00:00Z",
          publishedAt: "2026-09-03T01:30:00Z",
          supersededAt: "2026-09-03T02:00:00Z",
        },
      },
    };
    expect(
      blockerCodes(validate(rollback, approvalSetForCandidate(candidate))),
    ).toContain("CURRENT_PUBLICATION_EVIDENCE_MISSING");

    const evidencedRollback = {
      ...rollback,
      currentPublication:
        candidate.objectKind === "HOMEPAGE"
          ? {
              schemaVersion: 1 as const,
              id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
              objectKind: "HOMEPAGE" as const,
              action: "PUBLISH" as const,
              targetRevisionId: WRONG_REVISION_ID,
            }
          : {
              schemaVersion: 1 as const,
              id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
              objectKind: "POLICY" as const,
              action: "PUBLISH" as const,
              policyKey: candidate.revision.policyKey,
              targetRevisionId: WRONG_REVISION_ID,
            },
    };
    expect(
      validate(evidencedRollback, approvalSetForCandidate(candidate))
        .publishable,
    ).toBe(true);

    expect(
      blockerCodes(
        validate(
          {
            ...evidencedRollback,
            currentPublication: {
              ...evidencedRollback.currentPublication,
              targetRevisionId: candidate.revision.id,
            },
          },
          approvalSetForCandidate(candidate),
        ),
      ),
    ).toContain("CURRENT_PUBLICATION_EVIDENCE_MISMATCH");

    if (candidate.objectKind === "POLICY") {
      expect(
        blockerCodes(
          validate(
            {
              ...evidencedRollback,
              currentPublication: {
                ...evidencedRollback.currentPublication,
                policyKey: "different-policy",
              },
            },
            approvalSetForCandidate(candidate),
          ),
        ),
      ).toContain("CURRENT_PUBLICATION_EVIDENCE_MISMATCH");
    }

    const futureRollback = {
      ...evidencedRollback,
      revision: {
        ...evidencedRollback.revision,
        lifecycle: {
          ...evidencedRollback.revision.lifecycle,
          supersededAt: "2026-09-04T00:00:00Z",
        },
      },
    };
    expect(
      blockerCodes(
        validate(futureRollback, approvalSetForCandidate(candidate)),
      ),
    ).toContain("REVISION_LIFECYCLE_TIME_INVALID");

    expect(
      blockerCodes(
        validate(
          {
            ...evidencedRollback,
            currentPublishedRevisionId: evidencedRollback.revision.id,
          },
          approvalSetForCandidate(candidate),
        ),
      ),
    ).toContain("ROLLBACK_TARGET_INVALID");
  }
});

test("rejects publishing an Idol, Homepage, or Policy revision that is already current", async () => {
  const implementation = await loadImplementation();

  const idol = validIdolCandidate();
  const alreadyCurrentIdol = {
    ...idol,
    currentPublication: {
      schemaVersion: 1 as const,
      id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
      objectKind: "IDOL" as const,
      action: "PUBLISH" as const,
      idolId: idol.base.id,
      targetRevisionId: idol.revision.id,
    },
    base: { ...idol.base, publishedRevisionId: idol.revision.id },
  };
  expect(
    blockerCodes(
      implementation.validateIdolPublicationCandidate(
        alreadyCurrentIdol,
        approvalSetForCandidate(idol),
      ),
    ),
  ).toContain("PUBLISH_TARGET_ALREADY_CURRENT");

  const homepage = validHomepageCandidate();
  const alreadyCurrentHomepage = {
    ...homepage,
    currentPublishedRevisionId: homepage.revision.id,
    currentPublication: {
      schemaVersion: 1 as const,
      id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
      objectKind: "HOMEPAGE" as const,
      action: "PUBLISH" as const,
      targetRevisionId: homepage.revision.id,
    },
  };
  expect(
    blockerCodes(
      implementation.validateHomepagePublicationCandidate(
        alreadyCurrentHomepage,
        approvalSetForCandidate(homepage),
      ),
    ),
  ).toContain("PUBLISH_TARGET_ALREADY_CURRENT");

  const policy = validPolicyCandidate();
  const alreadyCurrentPolicy = {
    ...policy,
    currentPublishedRevisionId: policy.revision.id,
    currentPublication: {
      schemaVersion: 1 as const,
      id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
      objectKind: "POLICY" as const,
      action: "PUBLISH" as const,
      policyKey: policy.revision.policyKey,
      targetRevisionId: policy.revision.id,
    },
  };
  expect(
    blockerCodes(
      implementation.validatePolicyPublicationCandidate(
        alreadyCurrentPolicy,
        approvalSetForCandidate(policy),
      ),
    ),
  ).toContain("PUBLISH_TARGET_ALREADY_CURRENT");
});

test("keeps the exact supported locale set in every valid fixture", () => {
  for (const candidate of [
    validIdolCandidate(),
    validHomepageCandidate(),
    validPolicyCandidate(),
  ]) {
    expect(candidate.translations).toHaveLength(SUPPORTED_LOCALES.length);
    expect(new Set(candidate.translations.map((row) => row.locale))).toEqual(
      new Set(SUPPORTED_LOCALES),
    );
  }
});
