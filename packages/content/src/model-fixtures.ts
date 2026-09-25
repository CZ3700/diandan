import {
  homepageRevisionSchema,
  homepageRevisionTranslationSchema,
  homepageSlotSchema,
  idolBaseSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
  inventoryLedgerEntrySchema,
  inventoryLocationSchema,
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
  policyRevisionSchema,
  policyRevisionTranslationSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import type { SupportedLocale } from "@fan-support/contracts";

import { fictionalGiftPublicationCandidate } from "./fixtures.js";
import {
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";

const EDITOR_ID = "34d657b6-93b2-470f-a777-4ce1f98914e0";
const REVIEWER_ID = "c64367a8-350a-4fa5-b866-17ceeea511e0";
const IDOL_ID = "b74152dc-e245-44d5-97f5-ff84ef60e138";
const IDOL_REVISION_ID = "ea191a79-df54-410d-a32e-f966451976fb";
const HOMEPAGE_REVISION_ID = "8e863be7-d858-46c7-adca-dc4f57653d99";
const POLICY_REVISION_ID = "a8cdbe6d-6bc5-4191-9ecb-ef31dfcf39a4";
const INVENTORY_ITEM_ID = "0b91add0-e78b-4898-8b3d-3ab50c50a9dc";
const INVENTORY_LOCATION_ID = "88aab92a-fd64-43f1-8f59-15a4e4cb6dce";

function fixtureUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function fixtureHash(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}

const IDOL_PORTRAIT_ASSET_ID = fixtureUuid(700);
const IDOL_HERO_DESKTOP_ASSET_ID = fixtureUuid(701);
const IDOL_HERO_MOBILE_ASSET_ID = fixtureUuid(702);
const IDOL_PORTRAIT_METADATA_REVISION_ID = fixtureUuid(710);
const IDOL_HERO_DESKTOP_METADATA_REVISION_ID = fixtureUuid(711);
const IDOL_HERO_MOBILE_METADATA_REVISION_ID = fixtureUuid(712);

function localized(locale: SupportedLocale, english: string): string {
  switch (locale) {
    case "en":
      return english;
    case "zh-CN":
      return `${english}（虚构测试）`;
    case "th":
      return `${english} สำหรับการทดสอบสมมติ`;
    case "vi":
      return `${english} dùng cho thử nghiệm hư cấu`;
    case "ja":
      return `${english}（架空テスト）`;
    case "es":
      return `${english} para prueba ficticia`;
    case "pt":
      return `${english} para teste fictício`;
  }
}

function approvedAudit(
  locale: SupportedLocale,
  contentHash: string,
  englishSourceHash: string,
): Readonly<Record<string, unknown>> {
  return {
    locale,
    sourceHash: contentHash,
    translatedFromSourceHash: englishSourceHash,
    origin: "HUMAN",
    editorId: EDITOR_ID,
    editedAt: "2026-09-03T01:00:00Z",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: englishSourceHash,
      reviewedContentHash: contentHash,
    },
  };
}

function idolContent(locale: SupportedLocale) {
  return {
    displayName: localized(locale, "Luma Vale"),
    shortBio: localized(locale, "A fictional performer for contract tests."),
    fullBio: localized(
      locale,
      "Luma Vale is a fictional performer created only for deterministic tests.",
    ),
    seoTitle: localized(locale, "Luma Vale gifts"),
    seoDescription: localized(
      locale,
      "A fictional performer page used for contract testing.",
    ),
  };
}

const idolEnglishHash = computeIdolTranslationContentHash(idolContent("en"));
const idolTranslations = SUPPORTED_LOCALES.map((locale, index) => {
  const content = idolContent(locale);
  const contentHash = computeIdolTranslationContentHash(content);
  return idolRevisionTranslationSchema.parse({
    schemaVersion: 1,
    id: fixtureUuid(400 + index),
    idolRevisionId: IDOL_REVISION_ID,
    ...approvedAudit(locale, contentHash, idolEnglishHash),
    ...content,
  });
});

function homepageContent(locale: SupportedLocale) {
  return {
    heroTitle: localized(locale, "Send a thoughtful gift"),
    heroSubtitle: localized(
      locale,
      "Choose a fictional performer and a gift prepared by the platform.",
    ),
    ctaLabel: localized(locale, "Browse gifts"),
    announcement: localized(locale, "This is deterministic fixture content."),
    slotLabels: [
      {
        slotKey: "hero-luma",
        label: localized(locale, "Featured performer"),
      },
    ],
    seoTitle: localized(locale, "Fictional fan gifts"),
    seoDescription: localized(
      locale,
      "A fictional homepage used for contract testing.",
    ),
  };
}

const homepageEnglishHash = computeHomepageTranslationContentHash(
  homepageContent("en"),
);
const homepageTranslations = SUPPORTED_LOCALES.map((locale, index) => {
  const content = homepageContent(locale);
  const contentHash = computeHomepageTranslationContentHash(content);
  return homepageRevisionTranslationSchema.parse({
    schemaVersion: 1,
    id: fixtureUuid(500 + index),
    homepageRevisionId: HOMEPAGE_REVISION_ID,
    ...approvedAudit(locale, contentHash, homepageEnglishHash),
    ...content,
  });
});

function policyContent(locale: SupportedLocale) {
  return {
    title: localized(locale, "Fixture refund policy"),
    summary: localized(locale, "A fictional policy for contract tests."),
    body: localized(
      locale,
      "This fictional policy has no legal effect and contains no customer data.",
    ),
  };
}

const policyEnglishHash = computePolicyTranslationContentHash(
  policyContent("en"),
);
const policyTranslations = SUPPORTED_LOCALES.map((locale, index) => {
  const content = policyContent(locale);
  const contentHash = computePolicyTranslationContentHash(content);
  return policyRevisionTranslationSchema.parse({
    schemaVersion: 1,
    id: fixtureUuid(600 + index),
    policyRevisionId: POLICY_REVISION_ID,
    ...approvedAudit(locale, contentHash, policyEnglishHash),
    ...content,
  });
});

const idolBase = idolBaseSchema.parse(
  fictionalGiftPublicationCandidate.eligibleIdols[0],
);
const idolRevision = idolRevisionSchema.parse({
  schemaVersion: 1,
  id: IDOL_REVISION_ID,
  idolId: IDOL_ID,
  revision: 1,
  lifecycle: {
    status: "PUBLISHED",
    validatedAt: "2026-09-03T01:30:00Z",
    publishedAt: "2026-09-03T02:30:00Z",
  },
  themeAccent: "#5373A8",
  heroTextTone: "light",
  displayOrder: 1,
  createdBy: EDITOR_ID,
  createdAt: "2026-09-03T00:00:00Z",
});
const idolMediaProfiles = [
  {
    role: "PORTRAIT",
    sortOrder: 0,
    slug: "portrait",
    mediaAssetId: IDOL_PORTRAIT_ASSET_ID,
    mediaMetadataRevisionId: IDOL_PORTRAIT_METADATA_REVISION_ID,
    width: 1_600,
    height: 2_000,
    derivativeWidth: 1_280,
    derivativeHeight: 1_600,
    englishAlt: "Fictional portrait of Luma Vale",
  },
  {
    role: "HERO_DESKTOP",
    sortOrder: 1,
    slug: "hero-desktop",
    mediaAssetId: IDOL_HERO_DESKTOP_ASSET_ID,
    mediaMetadataRevisionId: IDOL_HERO_DESKTOP_METADATA_REVISION_ID,
    width: 2_400,
    height: 1_350,
    derivativeWidth: 1_920,
    derivativeHeight: 1_080,
    englishAlt: "Fictional desktop hero image of Luma Vale",
  },
  {
    role: "HERO_MOBILE",
    sortOrder: 2,
    slug: "hero-mobile",
    mediaAssetId: IDOL_HERO_MOBILE_ASSET_ID,
    mediaMetadataRevisionId: IDOL_HERO_MOBILE_METADATA_REVISION_ID,
    width: 1_080,
    height: 1_350,
    derivativeWidth: 864,
    derivativeHeight: 1_080,
    englishAlt: "Fictional mobile hero image of Luma Vale",
  },
] as const;

const idolMediaReferences = idolMediaProfiles.map((profile) =>
  idolRevisionMediaSchema.parse({
    schemaVersion: 1,
    idolRevisionId: IDOL_REVISION_ID,
    role: profile.role,
    mediaAssetId: profile.mediaAssetId,
    mediaMetadataRevisionId: profile.mediaMetadataRevisionId,
    sortOrder: profile.sortOrder,
  }),
);
const idolMediaAssets = idolMediaProfiles.map((profile, index) =>
  mediaAssetSchema.parse({
    schemaVersion: 1,
    id: profile.mediaAssetId,
    checksumSha256: fixtureHash(700 + index),
    mimeType: "image/jpeg",
    width: profile.width,
    height: profile.height,
    byteSize: 900_000 + index,
    objectKey: `fixtures/media/idol/luma-vale-${profile.slug}.jpg`,
    processingStatus: "READY",
    rightsStatus: "APPROVED",
    rightsReference: `fixture-idol-license-${profile.slug}`,
    createdAt: "2026-09-03T00:00:00Z",
  }),
);
const idolMediaVariants = idolMediaProfiles.flatMap((profile, profileIndex) =>
  (["AVIF", "WEBP", "JPEG"] as const).map((format, formatIndex) =>
    mediaVariantSchema.parse({
      schemaVersion: 1,
      id: fixtureUuid(800 + profileIndex * 10 + formatIndex),
      mediaAssetId: profile.mediaAssetId,
      format,
      width: profile.derivativeWidth,
      height: profile.derivativeHeight,
      byteSize: 240_000 + profileIndex * 1_000 + formatIndex,
      checksumSha256: fixtureHash(800 + profileIndex * 10 + formatIndex),
      objectKey: `fixtures/media/idol/luma-vale-${profile.slug}-${format.toLowerCase()}.${format === "JPEG" ? "jpg" : format.toLowerCase()}`,
      status: "READY",
    }),
  ),
);
const idolMediaMetadataRevisions = idolMediaProfiles.map((profile) =>
  mediaMetadataRevisionSchema.parse({
    schemaVersion: 1,
    id: profile.mediaMetadataRevisionId,
    mediaAssetId: profile.mediaAssetId,
    revision: 1,
    lifecycle: {
      status: "PUBLISHED",
      validatedAt: "2026-09-03T01:30:00Z",
      publishedAt: "2026-09-03T02:00:00Z",
    },
    presentationKind: "INFORMATIVE",
    focalPoint: { x: 0.5, y: 0.5 },
    createdBy: EDITOR_ID,
    createdAt: "2026-09-03T00:00:00Z",
  }),
);
const idolMediaTranslations = idolMediaProfiles.flatMap(
  (profile, profileIndex) => {
    const englishSourceHash = computeMediaTranslationContentHash({
      alt: profile.englishAlt,
    });
    return SUPPORTED_LOCALES.map((locale, localeIndex) => {
      const alt = localized(locale, profile.englishAlt);
      const contentHash = computeMediaTranslationContentHash({ alt });
      return mediaMetadataRevisionTranslationSchema.parse({
        schemaVersion: 1,
        id: fixtureUuid(
          900 + profileIndex * SUPPORTED_LOCALES.length + localeIndex,
        ),
        mediaMetadataRevisionId: profile.mediaMetadataRevisionId,
        ...approvedAudit(locale, contentHash, englishSourceHash),
        alt,
      });
    });
  },
);

const homepageRevision = homepageRevisionSchema.parse({
  schemaVersion: 1,
  id: HOMEPAGE_REVISION_ID,
  revision: 1,
  lifecycle: {
    status: "PUBLISHED",
    validatedAt: "2026-09-03T01:30:00Z",
    publishedAt: "2026-09-03T02:30:00Z",
  },
  createdBy: EDITOR_ID,
  createdAt: "2026-09-03T00:00:00Z",
});
const homepageSlots = [
  homepageSlotSchema.parse({
    schemaVersion: 1,
    homepageRevisionId: HOMEPAGE_REVISION_ID,
    slotKey: "hero-luma",
    kind: "HERO_IDOL",
    idolId: IDOL_ID,
    desktopMediaAssetId: IDOL_HERO_DESKTOP_ASSET_ID,
    desktopMediaMetadataRevisionId: IDOL_HERO_DESKTOP_METADATA_REVISION_ID,
    mobileMediaAssetId: IDOL_HERO_MOBILE_ASSET_ID,
    mobileMediaMetadataRevisionId: IDOL_HERO_MOBILE_METADATA_REVISION_ID,
    sortOrder: 0,
  }),
];

const policyRevision = policyRevisionSchema.parse({
  schemaVersion: 1,
  id: POLICY_REVISION_ID,
  policyKey: "fixture-refund-policy",
  kind: "REFUND",
  revision: 1,
  lifecycle: {
    status: "PUBLISHED",
    validatedAt: "2026-09-03T01:30:00Z",
    publishedAt: "2026-09-03T02:30:00Z",
  },
  effectiveAt: "2026-09-03T02:30:00Z",
  createdBy: EDITOR_ID,
  createdAt: "2026-09-03T00:00:00Z",
});

const inventoryLocation = inventoryLocationSchema.parse({
  schemaVersion: 1,
  id: INVENTORY_LOCATION_ID,
  code: "FIXTURE_STUDIO",
  status: "ACTIVE",
});
const inventoryLedgerEntry = inventoryLedgerEntrySchema.parse({
  schemaVersion: 1,
  id: "3fe77f73-174f-4676-b912-18db33e4ed18",
  inventoryItemId: INVENTORY_ITEM_ID,
  inventoryLocationId: INVENTORY_LOCATION_ID,
  deltaOnHand: 8,
  deltaReserved: 0,
  reasonCode: "FIXTURE_OPENING_BALANCE",
  idempotencyKey: "fixture-inventory-adjustment-0001",
  actor: {
    kind: "ADMIN",
    adminIdentityId: EDITOR_ID,
  },
  occurredAt: "2026-09-03T00:30:00Z",
});

export const fictionalContentModelFixture = {
  idol: {
    base: idolBase,
    revision: idolRevision,
    translations: idolTranslations,
    media: idolMediaReferences,
    references: idolMediaReferences,
    assets: idolMediaAssets,
    variants: idolMediaVariants,
    metadataRevisions: idolMediaMetadataRevisions,
    mediaTranslations: idolMediaTranslations,
  },
  giftPublication: fictionalGiftPublicationCandidate,
  homepage: {
    revision: homepageRevision,
    translations: homepageTranslations,
    slots: homepageSlots,
  },
  policy: {
    revision: policyRevision,
    translations: policyTranslations,
  },
  inventory: {
    location: inventoryLocation,
    ledgerEntry: inventoryLedgerEntry,
  },
};
