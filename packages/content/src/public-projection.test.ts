import { expect, test } from "vitest";

import { sourceHashSchema } from "@fan-support/contracts";

import { fictionalGiftPublicationCandidate } from "./fixtures.js";
import {
  computeGiftTranslationContentHash,
  computeMediaTranslationContentHash,
} from "./hashing.js";
import { fictionalContentModelFixture } from "./model-fixtures.js";
import {
  selectPublishedGift,
  selectPublishedHomepage,
  selectPublishedIdol,
  selectPublishedPolicy,
} from "./public-projection.js";

const PUBLICATION_ID = "65ea8b40-496c-4f85-b1e5-11572acb6689";

function fixtureUuid(sequence: number): string {
  return `20000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

type TranslationRow = Readonly<{
  id: string;
  locale: string;
  sourceHash: string;
  translatedFromSourceHash: string;
  origin: "HUMAN" | "MACHINE" | "IMPORT";
  importBatchId?: string | undefined;
}>;

function manifestCommon(row: TranslationRow, sequence: number) {
  return {
    schemaVersion: 1 as const,
    publicationId: PUBLICATION_ID,
    approvalId: fixtureUuid(sequence),
    translationRevisionId: row.id,
    locale: row.locale,
    approvedSourceHash: row.translatedFromSourceHash,
    approvedContentHash: row.sourceHash,
    origin: row.origin,
    importBatchId: row.importBatchId,
  };
}

function localeContext(row: TranslationRow) {
  return {
    schemaVersion: 1 as const,
    requestedLocale: "en" as const,
    resolvedLocale: "en" as const,
    fallbackUsed: false as const,
    translationRevision: row.id,
  };
}

function mediaSources(
  assets: typeof fictionalContentModelFixture.idol.assets,
  variants: typeof fictionalContentModelFixture.idol.variants,
  metadataRevisions: typeof fictionalContentModelFixture.idol.metadataRevisions,
  translations: typeof fictionalContentModelFixture.idol.mediaTranslations,
) {
  return metadataRevisions.map((metadata) => {
    const asset = assets.find(
      (candidate) => candidate.id === metadata.mediaAssetId,
    );
    const variant = variants.find(
      (candidate) =>
        candidate.mediaAssetId === metadata.mediaAssetId &&
        candidate.format === "WEBP" &&
        candidate.status === "READY",
    );
    const translation = translations.find(
      (row) =>
        row.mediaMetadataRevisionId === metadata.id && row.locale === "en",
    );
    if (
      asset === undefined ||
      variant === undefined ||
      translation === undefined
    ) {
      throw new Error(
        "fixture media must include its asset, derivative, and English translation",
      );
    }
    return {
      schemaVersion: 1 as const,
      mediaAssetId: metadata.mediaAssetId,
      mediaMetadataRevisionId: metadata.id,
      asset,
      variant,
      metadataRevision: metadata,
      translation,
      url: `https://media.example.invalid/${metadata.id}.webp`,
    };
  });
}

function mediaPublicationManifests(
  rows: readonly (TranslationRow & {
    readonly mediaMetadataRevisionId: string;
  })[],
  sequenceOffset: number,
) {
  return rows.map((row, index) => ({
    ...manifestCommon(row, sequenceOffset + index),
    objectKind: "MEDIA_METADATA" as const,
    mediaMetadataRevisionId: row.mediaMetadataRevisionId,
  }));
}

function publicationBase(
  translationManifest: readonly Record<string, unknown>[],
) {
  return {
    schemaVersion: 1 as const,
    id: PUBLICATION_ID,
    action: "PUBLISH" as const,
    replacesPublicationId: null,
    translationManifest,
    publishedBy: fixtureUuid(900),
    publishedAt: "2026-09-03T03:00:00Z",
  };
}

function idolProjectionFixture() {
  const fixture = fictionalContentModelFixture.idol;
  const translation = fixture.translations.find((row) => row.locale === "en")!;
  const media = mediaSources(
    fixture.assets,
    fixture.variants,
    fixture.metadataRevisions,
    fixture.mediaTranslations,
  );
  const source = {
    schemaVersion: 1 as const,
    objectKind: "IDOL" as const,
    localeContext: localeContext(translation),
    base: fixture.base,
    revision: fixture.revision,
    translation,
    mediaReferences: fixture.media,
    media,
  };
  const mainManifests = fixture.translations.map((row, index) => ({
    ...manifestCommon(row, 1 + index),
    objectKind: "IDOL" as const,
    idolRevisionId: fixture.revision.id,
  }));
  const allMediaManifests = mediaPublicationManifests(
    fixture.mediaTranslations,
    100,
  );
  const currentPublication = {
    ...publicationBase([...mainManifests, ...allMediaManifests]),
    objectKind: "IDOL" as const,
    idolId: fixture.base.id,
    idolRevisionId: fixture.revision.id,
    mediaMetadataRevisionIds: fixture.metadataRevisions.map(
      (metadata) => metadata.id,
    ),
  };
  const selection = {
    schemaVersion: 1 as const,
    objectKind: "IDOL" as const,
    idolId: fixture.base.id,
    operationalStatus: fixture.base.status,
    acceptingGifts: fixture.base.acceptingGifts,
    publishedRevisionId: fixture.revision.id,
    selectedRevisionId: fixture.revision.id,
    selectedRevisionLifecycle: "PUBLISHED" as const,
    selectedTranslation: mainManifests.find((entry) => entry.locale === "en")!,
    selectedMediaTranslations: allMediaManifests.filter(
      (entry) => entry.locale === "en",
    ),
    currentPublication,
  };
  return { selection, source };
}

function giftProjectionFixture() {
  const fixture = fictionalGiftPublicationCandidate;
  const translation = fixture.translations.find((row) => row.locale === "en")!;
  const media = mediaSources(
    fixture.mediaAssets,
    fixture.mediaVariants,
    fixture.mediaMetadataRevisions,
    fixture.mediaTranslations,
  );
  const publishedLifecycle = {
    status: "PUBLISHED" as const,
    validatedAt: "2026-09-03T02:30:00Z",
    publishedAt: "2026-09-03T03:00:00Z",
  };
  const source = {
    schemaVersion: 1 as const,
    objectKind: "GIFT" as const,
    localeContext: localeContext(translation),
    base: {
      ...fixture.base,
      status: "active" as const,
      publishedRevisionId: fixture.revision.id,
    },
    revision: { ...fixture.revision, lifecycle: publishedLifecycle },
    translation,
    variants: fixture.variants,
    mediaReferences: fixture.mediaReferences,
    media,
  };
  const mainManifests = fixture.translations.map((row, index) => ({
    ...manifestCommon(row, 200 + index),
    objectKind: "GIFT" as const,
    giftRevisionId: fixture.revision.id,
  }));
  const allMediaManifests = mediaPublicationManifests(
    fixture.mediaTranslations,
    300,
  );
  const currentPublication = {
    ...publicationBase([...mainManifests, ...allMediaManifests]),
    objectKind: "GIFT" as const,
    giftId: fixture.base.id,
    giftRevisionId: fixture.revision.id,
    mediaMetadataRevisionIds: fixture.mediaMetadataRevisions.map(
      (metadata) => metadata.id,
    ),
  };
  const selection = {
    schemaVersion: 1 as const,
    objectKind: "GIFT" as const,
    giftId: fixture.base.id,
    operationalStatus: "active" as const,
    publishedRevisionId: fixture.revision.id,
    selectedRevisionId: fixture.revision.id,
    selectedRevisionLifecycle: "PUBLISHED" as const,
    selectedTranslation: mainManifests.find((entry) => entry.locale === "en")!,
    selectedMediaTranslations: allMediaManifests.filter(
      (entry) => entry.locale === "en",
    ),
    currentPublication,
  };
  return { selection, source };
}

function homepageProjectionFixture() {
  const fixture = fictionalContentModelFixture.homepage;
  const translation = fixture.translations.find((row) => row.locale === "en")!;
  const referencedMetadataIds = new Set(
    fixture.slots
      .filter((slot) => slot.kind === "HERO_IDOL")
      .flatMap((slot) => [
        slot.desktopMediaMetadataRevisionId,
        slot.mobileMediaMetadataRevisionId,
      ]),
  );
  const media = mediaSources(
    fictionalContentModelFixture.idol.assets,
    fictionalContentModelFixture.idol.variants,
    fictionalContentModelFixture.idol.metadataRevisions.filter((metadata) =>
      referencedMetadataIds.has(metadata.id),
    ),
    fictionalContentModelFixture.idol.mediaTranslations.filter((row) =>
      referencedMetadataIds.has(row.mediaMetadataRevisionId),
    ),
  );
  const source = {
    schemaVersion: 1 as const,
    objectKind: "HOMEPAGE" as const,
    localeContext: localeContext(translation),
    revision: fixture.revision,
    translation,
    slots: fixture.slots,
    media,
  };
  const mainManifests = fixture.translations.map((row, index) => ({
    ...manifestCommon(row, 400 + index),
    objectKind: "HOMEPAGE" as const,
    homepageRevisionId: fixture.revision.id,
  }));
  const referencedMediaTranslations =
    fictionalContentModelFixture.idol.mediaTranslations.filter((row) =>
      referencedMetadataIds.has(row.mediaMetadataRevisionId),
    );
  const allMediaManifests = mediaPublicationManifests(
    referencedMediaTranslations,
    500,
  );
  const currentPublication = {
    ...publicationBase([...mainManifests, ...allMediaManifests]),
    objectKind: "HOMEPAGE" as const,
    homepageRevisionId: fixture.revision.id,
    mediaMetadataRevisionIds: [...referencedMetadataIds],
  };
  const selection = {
    schemaVersion: 1 as const,
    objectKind: "HOMEPAGE" as const,
    selectedRevisionId: fixture.revision.id,
    selectedRevisionLifecycle: "PUBLISHED" as const,
    selectedTranslation: mainManifests.find((entry) => entry.locale === "en")!,
    selectedMediaTranslations: allMediaManifests.filter(
      (entry) => entry.locale === "en",
    ),
    currentPublication,
  };
  return { selection, source };
}

function policyProjectionFixture() {
  const fixture = fictionalContentModelFixture.policy;
  const translation = fixture.translations.find((row) => row.locale === "en")!;
  const source = {
    schemaVersion: 1 as const,
    objectKind: "POLICY" as const,
    localeContext: localeContext(translation),
    revision: fixture.revision,
    translation,
  };
  const mainManifests = fixture.translations.map((row, index) => ({
    ...manifestCommon(row, 600 + index),
    objectKind: "POLICY" as const,
    policyRevisionId: fixture.revision.id,
  }));
  const currentPublication = {
    ...publicationBase(mainManifests),
    objectKind: "POLICY" as const,
    policyKey: fixture.revision.policyKey,
    policyRevisionId: fixture.revision.id,
    mediaMetadataRevisionIds: [],
  };
  const selection = {
    schemaVersion: 1 as const,
    objectKind: "POLICY" as const,
    policyKey: fixture.revision.policyKey,
    selectedRevisionId: fixture.revision.id,
    selectedRevisionLifecycle: "PUBLISHED" as const,
    selectedTranslation: mainManifests.find((entry) => entry.locale === "en")!,
    selectedMediaTranslations: [],
    currentPublication,
  };
  return { selection, source };
}

function blockerCodes(result: {
  readonly success: boolean;
  readonly issues?: readonly Readonly<{ code: string }>[];
}): ReadonlySet<string> {
  return new Set(result.issues?.map((issue) => issue.code) ?? []);
}

test("constructs complete public views only from canonical rows bound to publication manifests", () => {
  const idol = idolProjectionFixture();
  const idolResult = selectPublishedIdol(idol.selection, idol.source);
  expect(idolResult.success).toBe(true);
  if (idolResult.success) {
    expect(idolResult.value.fullBio).toBe(idol.source.translation.fullBio);
    expect(idolResult.value.heroDesktop.url).toMatch(/^https:\/\//u);
    expect(idolResult.value.heroDesktop).toMatchObject({
      width: idol.source.media[1]?.variant.width,
      height: idol.source.media[1]?.variant.height,
      focalPoint: idol.source.media[1]?.metadataRevision.focalPoint,
    });
    expect(idolResult.value.gallery).toEqual([]);
  }

  const gift = giftProjectionFixture();
  const giftResult = selectPublishedGift(gift.selection, gift.source);
  expect(giftResult.success).toBe(true);
  if (giftResult.success) {
    expect(giftResult.value.deliveryEstimate).toEqual(
      gift.source.revision.deliveryEstimate,
    );
    expect(giftResult.value.variants[0]?.label).toBe("Standard");
    expect(giftResult.value.primaryMedia.alt).toBe(
      gift.source.media[0]?.translation.alt,
    );
    expect(giftResult.value.category).toBe(gift.source.revision.category);
    expect(giftResult.value.contents).toEqual(gift.source.revision.contents);
    expect(giftResult.value.primaryMedia).toMatchObject({
      width: gift.source.media[0]?.variant.width,
      height: gift.source.media[0]?.variant.height,
      focalPoint: gift.source.media[0]?.metadataRevision.focalPoint,
    });
  }

  const homepage = homepageProjectionFixture();
  const homepageResult = selectPublishedHomepage(
    homepage.selection,
    homepage.source,
  );
  expect(homepageResult.success).toBe(true);
  if (homepageResult.success) {
    expect(homepageResult.value.slots[0]?.label).toBe("Featured performer");
    expect(homepageResult.value.seoTitle).toBe(
      homepage.source.translation.seoTitle,
    );
    expect(homepageResult.value.heroDesktop.url).not.toBe(
      homepageResult.value.heroMobile.url,
    );
    expect(homepageResult.value.heroDesktop.width).toBeGreaterThan(
      homepageResult.value.heroMobile.width,
    );
  }

  const policy = policyProjectionFixture();
  expect(selectPublishedPolicy(policy.selection, policy.source).success).toBe(
    true,
  );
});

test("requires current pointer, publication action, lifecycle, identity, and operational state to agree", () => {
  const gift = giftProjectionFixture();
  const wrongPointer = selectPublishedGift(
    {
      ...gift.selection,
      currentPublication: {
        ...gift.selection.currentPublication,
        giftRevisionId: "48790406-b59b-47bc-84e1-80b0094157a4",
      },
    },
    gift.source,
  );
  expect(blockerCodes(wrongPointer)).toContain("SCHEMA_INVALID");

  const idol = idolProjectionFixture();
  const driftedStatus = selectPublishedIdol(idol.selection, {
    ...idol.source,
    base: { ...idol.source.base, status: "paused", acceptingGifts: false },
  });
  expect(blockerCodes(driftedStatus)).toContain("PUBLIC_VIEW_STATUS_MISMATCH");

  const wrongIdentity = selectPublishedGift(gift.selection, {
    ...gift.source,
    base: {
      ...gift.source.base,
      id: "48790406-b59b-47bc-84e1-80b0094157a4",
    },
  });
  expect(blockerCodes(wrongIdentity)).toContain(
    "PUBLIC_VIEW_IDENTITY_MISMATCH",
  );

  const rollback = {
    ...gift,
    selection: {
      ...gift.selection,
      selectedRevisionLifecycle: "SUPERSEDED" as const,
      currentPublication: {
        ...gift.selection.currentPublication,
        action: "ROLLBACK" as const,
        replacesPublicationId: fixtureUuid(901),
      },
    },
    source: {
      ...gift.source,
      revision: {
        ...gift.source.revision,
        lifecycle: {
          status: "SUPERSEDED" as const,
          validatedAt: "2026-09-03T01:00:00Z",
          publishedAt: "2026-09-03T01:30:00Z",
          supersededAt: "2026-09-03T02:00:00Z",
        },
      },
    },
  };
  expect(selectPublishedGift(rollback.selection, rollback.source).success).toBe(
    true,
  );
  expect(
    blockerCodes(
      selectPublishedGift(
        {
          ...rollback.selection,
          selectedRevisionLifecycle: "PUBLISHED",
        },
        rollback.source,
      ),
    ),
  ).toContain("PUBLIC_REVISION_NOT_ELIGIBLE");

  const forgedSelection = {
    ...gift.selection,
    selectedTranslation: {
      ...gift.selection.selectedTranslation,
      approvalId: fixtureUuid(902),
    },
  };
  expect(
    blockerCodes(selectPublishedGift(forgedSelection, gift.source)),
  ).toContain("SCHEMA_INVALID");

  const draftMedia = {
    ...gift.source,
    media: gift.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            metadataRevision: {
              ...entry.metadataRevision,
              lifecycle: { status: "DRAFT" as const },
            },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, draftMedia)),
  ).toContain("MEDIA_METADATA_NOT_PUBLISHABLE");

  const wrongDerivativeAspect = {
    ...gift.source,
    media: gift.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            variant: { ...entry.variant, height: entry.variant.height - 1 },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, wrongDerivativeAspect)),
  ).toContain("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID");

  const undersizedDerivative = {
    ...gift.source,
    media: gift.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            variant: { ...entry.variant, width: 600, height: 600 },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, undersizedDerivative)),
  ).toContain("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING");

  const undersizedSource = {
    ...idol.source,
    media: idol.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            asset: {
              ...entry.asset,
              width: entry.variant.width,
              height: entry.variant.height,
            },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedIdol(idol.selection, undersizedSource)),
  ).toContain("MEDIA_SOURCE_DIMENSIONS_INVALID");

  const wrongSourceAspect = {
    ...idol.source,
    media: idol.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            asset: { ...entry.asset, width: entry.asset.width + 1 },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedIdol(idol.selection, wrongSourceAspect)),
  ).toContain("MEDIA_SOURCE_ASPECT_RATIO_INVALID");

  const invisibleAlt = {
    ...gift.source,
    media: gift.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            translation: { ...entry.translation, alt: "\u200B" },
          }
        : entry,
    ),
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, invisibleAlt)),
  ).toContain("MEDIA_ALT_MISSING");

  const allVariantsPaused = {
    ...gift.source,
    variants: gift.source.variants.map((variant) => ({
      ...variant,
      status: "paused" as const,
    })),
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, allVariantsPaused)),
  ).toContain("VARIANT_SELLABLE_MISSING");
});

test("requires informative metadata for every mandatory product and hero image", () => {
  const gift = giftProjectionFixture();
  const idol = idolProjectionFixture();
  const homepage = homepageProjectionFixture();

  const results = [
    selectPublishedGift(gift.selection, {
      ...gift.source,
      media: gift.source.media.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              metadataRevision: {
                ...entry.metadataRevision,
                presentationKind: "DECORATIVE" as const,
              },
            }
          : entry,
      ),
    }),
    selectPublishedIdol(idol.selection, {
      ...idol.source,
      media: idol.source.media.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              metadataRevision: {
                ...entry.metadataRevision,
                presentationKind: "DECORATIVE" as const,
              },
            }
          : entry,
      ),
    }),
    selectPublishedHomepage(homepage.selection, {
      ...homepage.source,
      media: homepage.source.media.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              metadataRevision: {
                ...entry.metadataRevision,
                presentationKind: "DECORATIVE" as const,
              },
            }
          : entry,
      ),
    }),
  ];

  for (const result of results) {
    expect(blockerCodes(result)).toContain("MEDIA_PRESENTATION_KIND_INVALID");
  }
});

test("rejects duplicate media references and role sort orders at projection time", () => {
  const idol = idolProjectionFixture();
  const portrait = idol.source.mediaReferences.find(
    (reference) => reference.role === "PORTRAIT",
  )!;
  const desktop = idol.source.mediaReferences.find(
    (reference) => reference.role === "HERO_DESKTOP",
  )!;

  const duplicateReference = selectPublishedIdol(idol.selection, {
    ...idol.source,
    mediaReferences: [
      ...idol.source.mediaReferences,
      { ...portrait, role: "GALLERY" as const, sortOrder: 10 },
      { ...portrait, role: "GALLERY" as const, sortOrder: 11 },
    ],
  });
  expect(blockerCodes(duplicateReference)).toContain(
    "MEDIA_REFERENCE_DUPLICATE",
  );

  const duplicateSortOrder = selectPublishedIdol(idol.selection, {
    ...idol.source,
    mediaReferences: [
      ...idol.source.mediaReferences,
      { ...portrait, role: "GALLERY" as const, sortOrder: 10 },
      { ...desktop, role: "GALLERY" as const, sortOrder: 10 },
    ],
  });
  expect(blockerCodes(duplicateSortOrder)).toContain(
    "MEDIA_SORT_ORDER_DUPLICATE",
  );
});

test("binds every object translation row to the selected parent revision", () => {
  const wrongRevisionId = fixtureUuid(999);
  const gift = giftProjectionFixture();
  const idol = idolProjectionFixture();
  const homepage = homepageProjectionFixture();
  const policy = policyProjectionFixture();

  const results = [
    selectPublishedGift(gift.selection, {
      ...gift.source,
      translation: {
        ...gift.source.translation,
        giftRevisionId: wrongRevisionId,
      },
    }),
    selectPublishedIdol(idol.selection, {
      ...idol.source,
      translation: {
        ...idol.source.translation,
        idolRevisionId: wrongRevisionId,
      },
    }),
    selectPublishedHomepage(homepage.selection, {
      ...homepage.source,
      translation: {
        ...homepage.source.translation,
        homepageRevisionId: wrongRevisionId,
      },
    }),
    selectPublishedPolicy(policy.selection, {
      ...policy.source,
      translation: {
        ...policy.source.translation,
        policyRevisionId: wrongRevisionId,
      },
    }),
  ];

  for (const result of results) {
    expect(blockerCodes(result)).toContain("PUBLIC_VIEW_TRANSLATION_MISMATCH");
  }
});

test("rejects localized copy tampering even when the attacker recomputes row hashes", () => {
  const gift = giftProjectionFixture();
  const changedTranslation = {
    ...gift.source.translation,
    title: `${gift.source.translation.title} altered`,
  };
  const forgedHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(changedTranslation),
  );
  const forgedSource = {
    ...gift.source,
    translation: {
      ...changedTranslation,
      sourceHash: forgedHash,
      translatedFromSourceHash: forgedHash,
      review: {
        ...changedTranslation.review,
        reviewedSourceHash: forgedHash,
        reviewedContentHash: forgedHash,
      },
    },
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, forgedSource)),
  ).toContain("PUBLIC_VIEW_CONTENT_MISMATCH");

  const driftedProvenance = {
    ...gift.source,
    translation: {
      ...gift.source.translation,
      origin: "MACHINE" as const,
    },
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, driftedProvenance)),
  ).toContain("PUBLIC_VIEW_CONTENT_MISMATCH");

  const wrongLocale = selectPublishedGift(gift.selection, {
    ...gift.source,
    translation: {
      ...gift.source.translation,
      locale: "es" as const,
    },
  });
  expect(blockerCodes(wrongLocale)).toContain("PUBLIC_VIEW_LOCALE_MISMATCH");

  const wrongTranslation = selectPublishedGift(gift.selection, {
    ...gift.source,
    translation: {
      ...gift.source.translation,
      id: "cb48856f-6030-4d43-a0bd-aaeeec9b30d5",
    },
  });
  expect(blockerCodes(wrongTranslation)).toContain(
    "PUBLIC_VIEW_TRANSLATION_MISMATCH",
  );
});

test("binds media alt text to its publication manifest without hashing dynamic CDN URLs", () => {
  const idol = idolProjectionFixture();
  const firstMedia = idol.source.media[0]!;
  const changedTranslation = {
    ...firstMedia.translation,
    alt: `${firstMedia.translation.alt} altered`,
  };
  const forgedHash = sourceHashSchema.parse(
    computeMediaTranslationContentHash(changedTranslation),
  );
  const tampered = {
    ...idol.source,
    media: idol.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            url: "https://another-cdn.example.invalid/image.webp",
            translation: {
              ...changedTranslation,
              sourceHash: forgedHash,
              translatedFromSourceHash: forgedHash,
              review: {
                ...changedTranslation.review,
                reviewedSourceHash: forgedHash,
                reviewedContentHash: forgedHash,
              },
            },
          }
        : entry,
    ),
  };
  expect(blockerCodes(selectPublishedIdol(idol.selection, tampered))).toContain(
    "PUBLIC_VIEW_CONTENT_MISMATCH",
  );

  const urlOnlyChange = {
    ...idol.source,
    media: idol.source.media.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            url: "https://another-cdn.example.invalid/image.webp",
          }
        : entry,
    ),
  };
  expect(selectPublishedIdol(idol.selection, urlOnlyChange).success).toBe(true);
});

test("does not accept a caller-supplied public DTO in place of canonical projection rows", () => {
  const gift = giftProjectionFixture();
  const arbitraryView = {
    schemaVersion: 1,
    id: gift.source.base.id,
    title: "Caller supplied",
  };
  expect(
    blockerCodes(selectPublishedGift(gift.selection, arbitraryView)),
  ).toContain("SCHEMA_INVALID");
});
