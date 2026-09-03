import { expect, test } from "vitest";

import {
  giftRevisionIdSchema,
  giftPublicationCandidateSchema,
  giftVariantIdSchema,
  priceBookIdSchema,
  priceIdSchema,
  sourceHashSchema,
  SUPPORTED_LOCALES,
  translationRevisionIdSchema,
} from "@fan-support/contracts";

import {
  fictionalGiftApprovalEvidence,
  fictionalGiftPublicationCandidate,
} from "./fixtures.js";
import {
  computeGiftTranslationContentHash,
  computeMediaTranslationContentHash,
} from "./hashing.js";
import {
  deriveTranslationEffectiveState,
  validateGiftPublicationCandidate,
} from "./publication.js";

function cloneCandidate(): typeof fictionalGiftPublicationCandidate {
  return giftPublicationCandidateSchema.parse(
    JSON.parse(JSON.stringify(fictionalGiftPublicationCandidate)),
  );
}

function cloneApprovalEvidence(): typeof fictionalGiftApprovalEvidence {
  return structuredClone(fictionalGiftApprovalEvidence);
}

function blockerCodes(
  candidate: unknown,
  approvals: unknown = cloneApprovalEvidence(),
): ReadonlySet<string> {
  const report = validateGiftPublicationCandidate(candidate, approvals);
  return new Set(
    report.issues
      .filter((issue) => issue.severity === "BLOCKER")
      .map((issue) => issue.code),
  );
}

test("accepts a complete deterministic fictional publication aggregate", () => {
  const candidate = cloneCandidate();
  const parsed = giftPublicationCandidateSchema.safeParse(candidate);
  const report = validateGiftPublicationCandidate(
    candidate,
    cloneApprovalEvidence(),
  );

  expect(parsed.success).toBe(true);
  expect(report.publishable).toBe(true);
  expect(report.issues.filter((issue) => issue.severity === "BLOCKER")).toEqual(
    [],
  );
  expect(JSON.parse(JSON.stringify(candidate))).toEqual(candidate);
  expect(
    new Set(candidate.translations.map((translation) => translation.locale)),
  ).toEqual(new Set(SUPPORTED_LOCALES));
});

test("derives MISSING and STALE rather than accepting writable pseudo-statuses", () => {
  const candidate = cloneCandidate();
  const english = candidate.translations.find(
    (translation) => translation.locale === "en",
  );
  const spanish = candidate.translations.find(
    (translation) => translation.locale === "es",
  );

  expect(english).toBeDefined();
  expect(spanish).toBeDefined();
  expect(deriveTranslationEffectiveState(undefined, english!.sourceHash)).toBe(
    "MISSING",
  );
  expect(deriveTranslationEffectiveState(spanish!, english!.sourceHash)).toBe(
    "APPROVED",
  );
  expect(deriveTranslationEffectiveState(spanish!, "f".repeat(64))).toBe(
    "STALE",
  );
});

test("requires the exact seven-locale translation package for the same revision", () => {
  const missing = cloneCandidate();
  missing.translations = missing.translations.filter(
    (translation) => translation.locale !== "th",
  );
  expect(blockerCodes(missing)).toContain("TRANSLATION_MISSING");

  const duplicate = cloneCandidate();
  const english = duplicate.translations.find(
    (translation) => translation.locale === "en",
  )!;
  duplicate.translations = duplicate.translations.map((translation) =>
    translation.locale === "th"
      ? {
          ...english,
          id: translationRevisionIdSchema.parse(
            "18e0f3fd-a3ec-4306-a08f-5b83c48f1ccf",
          ),
        }
      : translation,
  );
  const duplicateCodes = blockerCodes(duplicate);
  expect(duplicateCodes).toContain("TRANSLATION_DUPLICATE");
  expect(duplicateCodes).toContain("TRANSLATION_MISSING");

  const wrongParent = cloneCandidate();
  wrongParent.translations[0] = {
    ...wrongParent.translations[0]!,
    giftRevisionId: giftRevisionIdSchema.parse(
      "48790406-b59b-47bc-84e1-80b0094157a4",
    ),
  };
  expect(blockerCodes(wrongParent)).toContain("TRANSLATION_PARENT_MISMATCH");

  const wrongVariantLabels = cloneCandidate();
  wrongVariantLabels.translations[0] = {
    ...wrongVariantLabels.translations[0]!,
    variantLabels: [
      {
        giftVariantId: giftVariantIdSchema.parse(
          "4153079f-b686-4d1e-95d9-d4692915641e",
        ),
        label: "Wrong variant",
      },
    ],
  };
  expect(blockerCodes(wrongVariantLabels)).toContain("VARIANT_LABEL_MISMATCH");
});

test("blocks stale or unapproved required translations and missing safety copy", () => {
  const stale = cloneCandidate();
  const staleIndex = stale.translations.findIndex(
    (translation) => translation.locale === "vi",
  );
  const staleTranslation = stale.translations[staleIndex]!;
  if (staleTranslation.review.status !== "APPROVED") {
    throw new Error("fixture translation must begin approved");
  }
  stale.translations[staleIndex] = {
    ...staleTranslation,
    translatedFromSourceHash: sourceHashSchema.parse("f".repeat(64)),
    review: {
      ...staleTranslation.review,
      reviewedSourceHash: sourceHashSchema.parse("f".repeat(64)),
    },
  };
  expect(blockerCodes(stale)).toContain("TRANSLATION_STALE");

  const draft = cloneCandidate();
  draft.translations[1] = {
    ...draft.translations[1]!,
    review: { status: "DRAFT" },
  };
  expect(blockerCodes(draft)).toContain("TRANSLATION_NOT_APPROVED");

  const safety = cloneCandidate();
  safety.revision = { ...safety.revision, requiresSafetyNotice: true };
  safety.translations = safety.translations.map((translation) => {
    const row = { ...translation };
    delete row.safetyNotice;
    return row;
  });
  expect(blockerCodes(safety)).toContain("SAFETY_NOTICE_MISSING");
});

test("recomputes stable localized content hashes so approved copy cannot be edited in place", () => {
  const candidate = cloneCandidate();
  const englishIndex = candidate.translations.findIndex(
    (translation) => translation.locale === "en",
  );
  const english = candidate.translations[englishIndex]!;
  candidate.translations[englishIndex] = {
    ...english,
    title: `${english.title}!`,
  };

  expect(blockerCodes(candidate)).toContain(
    "TRANSLATION_CONTENT_HASH_MISMATCH",
  );

  const forged = cloneCandidate();
  const forgedIndex = forged.translations.findIndex(
    (translation) => translation.locale === "es",
  );
  const forgedRow = forged.translations[forgedIndex]!;
  if (forgedRow.review.status !== "APPROVED") {
    throw new Error("fixture translation must begin approved");
  }
  const alteredTitle = `${forgedRow.title} altered`;
  const forgedHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash({
      ...forgedRow,
      title: alteredTitle,
    }),
  );
  forged.translations[forgedIndex] = {
    ...forgedRow,
    title: alteredTitle,
    sourceHash: forgedHash,
    review: {
      ...forgedRow.review,
      reviewedContentHash: forgedHash,
    },
  };
  expect(blockerCodes(forged)).toContain("TRANSLATION_APPROVAL_MISMATCH");
  expect(blockerCodes(cloneCandidate(), [])).toContain(
    "TRANSLATION_APPROVAL_MISSING",
  );

  const duplicateApprovals = cloneApprovalEvidence();
  duplicateApprovals.push({ ...duplicateApprovals[0]! });
  expect(blockerCodes(cloneCandidate(), duplicateApprovals)).toContain(
    "TRANSLATION_APPROVAL_DUPLICATE",
  );

  const caseVariantApprovalIds = cloneApprovalEvidence();
  caseVariantApprovalIds[1] = {
    ...caseVariantApprovalIds[1]!,
    approvalId:
      caseVariantApprovalIds[0]!.approvalId.toUpperCase() as (typeof caseVariantApprovalIds)[number]["approvalId"],
  };
  expect(blockerCodes(cloneCandidate(), caseVariantApprovalIds)).toContain(
    "TRANSLATION_APPROVAL_DUPLICATE",
  );

  const replayedAcrossProvenance = cloneCandidate();
  replayedAcrossProvenance.translations[1] = {
    ...replayedAcrossProvenance.translations[1]!,
    origin: "IMPORT",
    importBatchId: "0a593f70-94a5-4acd-a717-11f6c6795a11",
  };
  expect(blockerCodes(replayedAcrossProvenance)).toContain(
    "TRANSLATION_APPROVAL_MISMATCH",
  );

  const left = computeGiftTranslationContentHash({
    title: "Café",
    shortDescription: "Short",
    description: "Description",
    fulfillmentDescription: "Fulfillment",
    variantLabels: [
      {
        giftVariantId: giftVariantIdSchema.parse(
          "3f15ce90-171b-4c76-8238-118212242295",
        ),
        label: "Standard",
      },
      {
        giftVariantId: giftVariantIdSchema.parse(
          "4f15ce90-171b-4c76-8238-118212242295",
        ),
        label: "Premium",
      },
    ],
    seoTitle: "SEO",
    seoDescription: "SEO description",
  });
  const right = computeGiftTranslationContentHash({
    seoDescription: "SEO description",
    seoTitle: "SEO",
    fulfillmentDescription: "Fulfillment",
    description: "Description",
    shortDescription: "Short",
    title: "Cafe\u0301",
    variantLabels: [
      {
        giftVariantId: giftVariantIdSchema.parse(
          "4f15ce90-171b-4c76-8238-118212242295",
        ),
        label: "Premium",
      },
      {
        giftVariantId: giftVariantIdSchema.parse(
          "3f15ce90-171b-4c76-8238-118212242295",
        ),
        label: "Standard",
      },
    ],
  });
  expect(left).toBe(right);
});

test("conjoins variant eligibility, published price, and qualified media gates", () => {
  const withoutEligibility = cloneCandidate();
  withoutEligibility.eligibility = [];
  expect(blockerCodes(withoutEligibility)).toContain("ELIGIBILITY_MISSING");

  const unpublishedIdol = cloneCandidate();
  unpublishedIdol.eligibleIdols[0] = {
    ...unpublishedIdol.eligibleIdols[0]!,
    publishedRevisionId: null,
  };
  expect(blockerCodes(unpublishedIdol)).toContain(
    "ELIGIBLE_IDOL_NOT_PUBLISHED",
  );

  const withoutPrice = cloneCandidate();
  withoutPrice.prices = [];
  expect(blockerCodes(withoutPrice)).toContain("PRICE_MISSING");

  const draftPriceBook = cloneCandidate();
  draftPriceBook.priceBooks[0] = {
    ...draftPriceBook.priceBooks[0]!,
    status: "VALIDATED",
  };
  expect(blockerCodes(draftPriceBook)).toContain("PRICE_BOOK_NOT_PUBLISHED");

  const withoutMedia = cloneCandidate();
  withoutMedia.mediaReferences = [];
  expect(blockerCodes(withoutMedia)).toContain("MEDIA_MISSING");

  const failedMedia = cloneCandidate();
  failedMedia.mediaAssets[0] = {
    ...failedMedia.mediaAssets[0]!,
    processingStatus: "FAILED",
    processingErrorCode: "FIXTURE_FAILURE",
  };
  expect(blockerCodes(failedMedia)).toContain("MEDIA_ASSET_NOT_READY");

  const unlicensedMedia = cloneCandidate();
  unlicensedMedia.mediaAssets[0] = {
    ...unlicensedMedia.mediaAssets[0]!,
    rightsStatus: "REJECTED",
  };
  expect(blockerCodes(unlicensedMedia)).toContain("MEDIA_RIGHTS_NOT_APPROVED");

  const futureMetadata = cloneCandidate();
  futureMetadata.mediaMetadataRevisions[0] = {
    ...futureMetadata.mediaMetadataRevisions[0]!,
    lifecycle: {
      status: "PUBLISHED",
      validatedAt: "2026-09-03T01:30:00Z",
      publishedAt: "2026-09-04T00:00:00Z",
    },
  };
  expect(blockerCodes(futureMetadata)).toContain(
    "REVISION_LIFECYCLE_TIME_INVALID",
  );

  const staleMetadata = cloneCandidate();
  staleMetadata.mediaMetadataRevisions[0] = {
    ...staleMetadata.mediaMetadataRevisions[0]!,
    id: staleMetadata.mediaMetadataRevisions[0]!.id.toUpperCase() as (typeof staleMetadata.mediaMetadataRevisions)[number]["id"],
    lifecycle: {
      status: "SUPERSEDED",
      validatedAt: "2026-09-03T01:00:00Z",
      publishedAt: "2026-09-03T01:30:00Z",
      supersededAt: "2026-09-03T02:00:00Z",
    },
  };
  expect(blockerCodes(staleMetadata)).toContain(
    "MEDIA_METADATA_NOT_PUBLISHABLE",
  );

  const missingDerivative = cloneCandidate();
  missingDerivative.mediaVariants = missingDerivative.mediaVariants.filter(
    (variant) => variant.format !== "AVIF",
  );
  expect(blockerCodes(missingDerivative)).toContain("MEDIA_DERIVATIVE_MISSING");

  const missingAlt = cloneCandidate();
  const mediaTranslationIndex = missingAlt.mediaTranslations.findIndex(
    (translation) => translation.locale === "es",
  );
  const mediaTranslation = missingAlt.mediaTranslations[mediaTranslationIndex]!;
  if (mediaTranslation.review.status !== "APPROVED") {
    throw new Error("fixture media translation must begin approved");
  }
  const emptyAltHash = sourceHashSchema.parse(
    computeMediaTranslationContentHash({ alt: "\u200B" }),
  );
  missingAlt.mediaTranslations[mediaTranslationIndex] = {
    ...mediaTranslation,
    alt: "\u200B",
    sourceHash: emptyAltHash,
    review: {
      ...mediaTranslation.review,
      reviewedContentHash: emptyAltHash,
    },
  };
  expect(blockerCodes(missingAlt)).toContain("MEDIA_ALT_MISSING");

  const unrelatedMediaTranslation = cloneCandidate();
  unrelatedMediaTranslation.mediaTranslations[0] = {
    ...unrelatedMediaTranslation.mediaTranslations[0]!,
    mediaMetadataRevisionId:
      "08b04355-e1c7-46fb-8c98-f84445f68a65" as (typeof unrelatedMediaTranslation.mediaTranslations)[number]["mediaMetadataRevisionId"],
  };
  expect(blockerCodes(unrelatedMediaTranslation)).toContain(
    "TRANSLATION_PARENT_MISMATCH",
  );
});

test("rejects invalid lifecycle pointers, overlapping prices, and unknown aggregate fields", () => {
  const archived = cloneCandidate();
  archived.base = { ...archived.base, status: "archived" };
  expect(blockerCodes(archived)).toContain("BASE_ARCHIVED");

  const wrongLifecycle = cloneCandidate();
  wrongLifecycle.revision = {
    ...wrongLifecycle.revision,
    lifecycle: { status: "DRAFT" },
  };
  expect(blockerCodes(wrongLifecycle)).toContain("REVISION_NOT_VALIDATED");

  const futureLifecycle = cloneCandidate();
  futureLifecycle.revision = {
    ...futureLifecycle.revision,
    lifecycle: {
      status: "VALIDATED",
      validatedAt: "2026-09-04T00:00:00Z",
    },
  };
  expect(blockerCodes(futureLifecycle)).toContain(
    "REVISION_LIFECYCLE_TIME_INVALID",
  );

  const wrongPointer = cloneCandidate();
  wrongPointer.base = { ...wrongPointer.base, draftRevisionId: null };
  expect(blockerCodes(wrongPointer)).toContain("DRAFT_POINTER_MISMATCH");

  const overlapping = cloneCandidate();
  overlapping.prices.push({
    ...overlapping.prices[0]!,
    id: priceIdSchema.parse("c2fb8700-8afd-47ec-a846-5afb67711ca9"),
    validFrom: "2026-09-15T00:00:00Z",
    validUntil: "2026-09-30T00:00:00Z",
  });
  expect(blockerCodes(overlapping)).toContain("PRICE_OVERLAP");

  expect(
    blockerCodes({
      ...cloneCandidate(),
      internalObjectKey: "must-not-be-accepted",
    }),
  ).toContain("SCHEMA_INVALID");
});

test("requires canonical current-publication evidence before rolling a gift back", () => {
  const target = cloneCandidate();
  const currentRevisionId = giftRevisionIdSchema.parse(
    "48790406-b59b-47bc-84e1-80b0094157a4",
  );
  const rollback = {
    ...target,
    action: "ROLLBACK" as const,
    currentPublication: null,
    base: {
      ...target.base,
      draftRevisionId: null,
      publishedRevisionId: currentRevisionId,
    },
    revision: {
      ...target.revision,
      lifecycle: {
        status: "SUPERSEDED" as const,
        validatedAt: "2026-09-03T01:00:00Z",
        publishedAt: "2026-09-03T01:30:00Z",
        supersededAt: "2026-09-03T02:00:00Z",
      },
    },
  };

  expect(blockerCodes(rollback)).toContain(
    "CURRENT_PUBLICATION_EVIDENCE_MISSING",
  );

  const evidencedRollback = {
    ...rollback,
    currentPublication: {
      schemaVersion: 1 as const,
      id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
      objectKind: "GIFT" as const,
      action: "PUBLISH" as const,
      giftId: target.base.id,
      targetRevisionId: currentRevisionId,
    },
  };
  expect(
    validateGiftPublicationCandidate(evidencedRollback, cloneApprovalEvidence())
      .publishable,
  ).toBe(true);

  expect(
    blockerCodes({
      ...evidencedRollback,
      currentPublication: {
        ...evidencedRollback.currentPublication,
        targetRevisionId: target.revision.id,
      },
    }),
  ).toContain("CURRENT_PUBLICATION_EVIDENCE_MISMATCH");
  expect(
    blockerCodes({
      ...evidencedRollback,
      currentPublication: {
        ...evidencedRollback.currentPublication,
        giftId: "b74152dc-e245-44d5-97f5-ff84ef60e138",
      },
    }),
  ).toContain("CURRENT_PUBLICATION_EVIDENCE_MISMATCH");

  expect(
    blockerCodes({
      ...evidencedRollback,
      base: {
        ...evidencedRollback.base,
        publishedRevisionId: evidencedRollback.revision.id,
      },
    }),
  ).toContain("ROLLBACK_TARGET_INVALID");
});

test("rejects publishing a gift revision that is already current", () => {
  const candidate = cloneCandidate();
  const alreadyCurrent = {
    ...candidate,
    currentPublication: {
      schemaVersion: 1 as const,
      id: "4ce081a5-4ab7-4b3c-ad71-b5a603968c15",
      objectKind: "GIFT" as const,
      action: "PUBLISH" as const,
      giftId: candidate.base.id,
      targetRevisionId: candidate.revision.id,
    },
    base: {
      ...candidate.base,
      publishedRevisionId: candidate.revision.id,
    },
  };

  expect(blockerCodes(alreadyCurrent)).toContain(
    "PUBLISH_TARGET_ALREADY_CURRENT",
  );
});

test("detects price overlap on the price and price-book interval intersection", () => {
  const adjacentBooks = cloneCandidate();
  const secondPriceBookId = priceBookIdSchema.parse(
    "54ee2f51-b1ad-41c4-98e5-75446b4a4178",
  );
  adjacentBooks.priceBooks.push({
    ...adjacentBooks.priceBooks[0]!,
    id: secondPriceBookId,
    validFrom: "2026-10-01T00:00:00Z",
    validUntil: "2026-11-01T00:00:00Z",
  });
  adjacentBooks.prices.push({
    ...adjacentBooks.prices[0]!,
    id: priceIdSchema.parse("39270fd0-752d-4107-bb17-a16a0b44f719"),
    priceBookId: secondPriceBookId,
    validFrom: "2026-09-15T00:00:00Z",
    validUntil: "2026-10-15T00:00:00Z",
  });

  expect(blockerCodes(adjacentBooks)).not.toContain("PRICE_OVERLAP");

  adjacentBooks.priceBooks[1] = {
    ...adjacentBooks.priceBooks[1]!,
    validFrom: "2026-09-30T00:00:00Z",
  };
  expect(blockerCodes(adjacentBooks)).toContain("PRICE_OVERLAP");
});

test("rejects duplicate price identities and price-book revisions", () => {
  const candidate = cloneCandidate();
  candidate.priceBooks.push({
    ...candidate.priceBooks[0]!,
    id: candidate.priceBooks[0]!.id.toUpperCase() as (typeof candidate.priceBooks)[number]["id"],
    validFrom: "2026-09-15T00:00:00Z",
  });
  candidate.prices.push({
    ...candidate.prices[0]!,
    id: candidate.prices[0]!.id.toUpperCase() as (typeof candidate.prices)[number]["id"],
  });

  const codes = blockerCodes(candidate);
  expect(codes).toContain("PRICE_BOOK_DUPLICATE");
  expect(codes).toContain("PRICE_DUPLICATE");

  const duplicateVariant = cloneCandidate();
  duplicateVariant.variants.push({
    ...duplicateVariant.variants[0]!,
    id: duplicateVariant.variants[0]!.id.toUpperCase() as (typeof duplicateVariant.variants)[number]["id"],
    sku: "AURORA-KEEPSAKE-02",
  });
  expect(blockerCodes(duplicateVariant)).toContain("VARIANT_DUPLICATE_ID");
});

test("rejects commerce evidence that belongs to another variant or drifts from its definition", () => {
  const candidate = cloneCandidate();
  candidate.inventoryItems[0] = {
    ...candidate.inventoryItems[0]!,
    sku: "WRONG-SKU",
    policy: "PREORDER",
  };
  expect(blockerCodes(candidate)).toContain("INVENTORY_ITEM_MISMATCH");

  const unrelatedPrice = cloneCandidate();
  unrelatedPrice.prices.push({
    ...unrelatedPrice.prices[0]!,
    id: priceIdSchema.parse("c3a41d13-665f-4a92-b057-e8285c45ff7d"),
    giftVariantId: giftVariantIdSchema.parse(
      "4153079f-b686-4d1e-95d9-d4692915641e",
    ),
  });
  expect(blockerCodes(unrelatedPrice)).toContain("PRICE_VARIANT_MISMATCH");
});

test("does not confuse zero inventory with content publication eligibility", () => {
  const candidate = cloneCandidate();
  candidate.inventoryBalances = candidate.inventoryBalances.map((balance) => ({
    ...balance,
    onHand: 0,
    reserved: 0,
  }));

  expect(
    validateGiftPublicationCandidate(candidate, cloneApprovalEvidence())
      .publishable,
  ).toBe(true);
});

test("requires a sellable variant and inventory identity for tracked variants", () => {
  const allArchived = cloneCandidate();
  allArchived.targetOperationalStatus = "paused";
  allArchived.variants = allArchived.variants.map((variant) => ({
    ...variant,
    status: "archived" as const,
  }));
  expect(blockerCodes(allArchived)).toContain("VARIANT_MISSING");
  expect(
    validateGiftPublicationCandidate(allArchived, cloneApprovalEvidence())
      .publishable,
  ).toBe(false);

  const missingTrackedItem = cloneCandidate();
  missingTrackedItem.inventoryItems = [];
  missingTrackedItem.inventoryBalances = [];
  expect(blockerCodes(missingTrackedItem)).toContain("INVENTORY_ITEM_MISSING");
});
