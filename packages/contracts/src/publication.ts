import { z } from "zod";

import { catalogOperationalStatusSchema } from "./catalog.js";
import {
  giftBaseSchema,
  giftRevisionMediaSchema,
  giftRevisionSchema,
  giftRevisionTranslationSchema,
  giftVariantDefinitionSchema,
  giftVariantIdolEligibilitySchema,
  idolBaseSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
} from "./catalog-content.js";
import {
  catalogRevisionLifecycleStatusSchema,
  contentTimestampSchema,
  sourceHashSchema,
  translationOriginSchema,
} from "./content-lifecycle.js";
import {
  homepageRevisionSchema,
  homepageRevisionTranslationSchema,
  homepageSlotSchema,
  policyKeySchema,
  policyRevisionSchema,
  policyRevisionTranslationSchema,
} from "./content-models.js";
import {
  adminIdentityIdSchema,
  contentPublicationIdSchema,
  giftIdSchema,
  giftRevisionIdSchema,
  homepageRevisionIdSchema,
  homepageTranslationRevisionIdSchema,
  idolIdSchema,
  idolRevisionIdSchema,
  mediaMetadataRevisionIdSchema,
  policyRevisionIdSchema,
  policyTranslationRevisionIdSchema,
  translationApprovalIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { SUPPORTED_LOCALES, supportedLocaleSchema } from "./locale.js";
import {
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
} from "./media-content.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  priceBookRevisionSchema,
  priceSchema,
} from "./pricing-inventory-content.js";
import { schemaVersionSchema } from "./versioning.js";

const publicationCandidateBaseShape = {
  schemaVersion: schemaVersionSchema,
  action: z.enum(["PUBLISH", "ROLLBACK"]),
  evaluatedAt: contentTimestampSchema,
} as const;

const currentPublicationEvidenceBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: contentPublicationIdSchema,
  action: z.enum(["PUBLISH", "ROLLBACK"]),
} as const;

export const giftPublicationCandidateSchema = z.strictObject({
  ...publicationCandidateBaseShape,
  objectKind: z.literal("GIFT"),
  currentPublication: z
    .strictObject({
      ...currentPublicationEvidenceBaseShape,
      objectKind: z.literal("GIFT"),
      giftId: giftIdSchema,
      targetRevisionId: giftRevisionIdSchema,
    })
    .nullable(),
  targetOperationalStatus: z.enum(["active", "paused"]),
  base: giftBaseSchema,
  revision: giftRevisionSchema,
  translations: z.array(giftRevisionTranslationSchema),
  variants: z.array(giftVariantDefinitionSchema),
  eligibleIdols: z.array(idolBaseSchema),
  eligibility: z.array(giftVariantIdolEligibilitySchema),
  priceBooks: z.array(priceBookRevisionSchema),
  prices: z.array(priceSchema),
  mediaReferences: z.array(giftRevisionMediaSchema),
  mediaAssets: z.array(mediaAssetSchema),
  mediaVariants: z.array(mediaVariantSchema),
  mediaMetadataRevisions: z.array(mediaMetadataRevisionSchema),
  mediaTranslations: z.array(mediaMetadataRevisionTranslationSchema),
  inventoryItems: z.array(inventoryItemSchema),
  inventoryBalances: z.array(inventoryBalanceSchema),
});

export const idolPublicationCandidateSchema = z.strictObject({
  ...publicationCandidateBaseShape,
  objectKind: z.literal("IDOL"),
  currentPublication: z
    .strictObject({
      ...currentPublicationEvidenceBaseShape,
      objectKind: z.literal("IDOL"),
      idolId: idolIdSchema,
      targetRevisionId: idolRevisionIdSchema,
    })
    .nullable(),
  targetOperationalStatus: z.enum(["active", "paused"]),
  targetAcceptingGifts: z.boolean(),
  base: idolBaseSchema,
  revision: idolRevisionSchema,
  translations: z.array(idolRevisionTranslationSchema),
  mediaReferences: z.array(idolRevisionMediaSchema),
  mediaAssets: z.array(mediaAssetSchema),
  mediaVariants: z.array(mediaVariantSchema),
  mediaMetadataRevisions: z.array(mediaMetadataRevisionSchema),
  mediaTranslations: z.array(mediaMetadataRevisionTranslationSchema),
});

export const homepagePublicationCandidateSchema = z.strictObject({
  ...publicationCandidateBaseShape,
  objectKind: z.literal("HOMEPAGE"),
  currentPublication: z
    .strictObject({
      ...currentPublicationEvidenceBaseShape,
      objectKind: z.literal("HOMEPAGE"),
      targetRevisionId: homepageRevisionIdSchema,
    })
    .nullable(),
  currentPublishedRevisionId: homepageRevisionIdSchema.nullable(),
  revision: homepageRevisionSchema,
  translations: z.array(homepageRevisionTranslationSchema),
  slots: z.array(homepageSlotSchema),
  referencedIdols: z.array(idolBaseSchema),
  referencedGifts: z.array(giftBaseSchema),
  referencedPolicies: z.array(
    z
      .strictObject({
        schemaVersion: schemaVersionSchema,
        policyKey: policyKeySchema,
        publishedRevisionId: policyRevisionIdSchema,
        selectedRevisionLifecycle: z.enum(["PUBLISHED", "SUPERSEDED"]),
        currentPublication: z.strictObject({
          ...currentPublicationEvidenceBaseShape,
          objectKind: z.literal("POLICY"),
          policyKey: policyKeySchema,
          targetRevisionId: policyRevisionIdSchema,
        }),
      })
      .superRefine((value, context) => {
        if (value.currentPublication.policyKey !== value.policyKey) {
          context.addIssue({
            code: "custom",
            message: "current policy publication must identify the policy",
            path: ["currentPublication", "policyKey"],
          });
        }
        if (
          value.currentPublication.targetRevisionId.toLowerCase() !==
          value.publishedRevisionId.toLowerCase()
        ) {
          context.addIssue({
            code: "custom",
            message:
              "current policy publication must target the published revision",
            path: ["currentPublication", "targetRevisionId"],
          });
        }
        const expectedLifecycle =
          value.currentPublication.action === "PUBLISH"
            ? "PUBLISHED"
            : "SUPERSEDED";
        if (value.selectedRevisionLifecycle !== expectedLifecycle) {
          context.addIssue({
            code: "custom",
            message: "policy lifecycle must agree with the publication action",
            path: ["selectedRevisionLifecycle"],
          });
        }
      }),
  ),
  mediaAssets: z.array(mediaAssetSchema),
  mediaVariants: z.array(mediaVariantSchema),
  mediaMetadataRevisions: z.array(mediaMetadataRevisionSchema),
  mediaTranslations: z.array(mediaMetadataRevisionTranslationSchema),
});

export const policyPublicationCandidateSchema = z.strictObject({
  ...publicationCandidateBaseShape,
  objectKind: z.literal("POLICY"),
  currentPublication: z
    .strictObject({
      ...currentPublicationEvidenceBaseShape,
      objectKind: z.literal("POLICY"),
      policyKey: policyKeySchema,
      targetRevisionId: policyRevisionIdSchema,
    })
    .nullable(),
  currentPublishedRevisionId: policyRevisionIdSchema.nullable(),
  revision: policyRevisionSchema,
  translations: z.array(policyRevisionTranslationSchema),
});

export const contentPublicationCandidateSchema = z.discriminatedUnion(
  "objectKind",
  [
    idolPublicationCandidateSchema,
    giftPublicationCandidateSchema,
    homepagePublicationCandidateSchema,
    policyPublicationCandidateSchema,
  ],
);

const approvalEvidenceBaseShape = {
  schemaVersion: schemaVersionSchema,
  approvalId: translationApprovalIdSchema,
  locale: supportedLocaleSchema,
  approvedSourceHash: sourceHashSchema,
  approvedContentHash: sourceHashSchema,
  origin: translationOriginSchema,
  importBatchId: z.uuid().optional(),
  editorId: adminIdentityIdSchema,
  reviewerId: adminIdentityIdSchema,
  reviewedAt: contentTimestampSchema,
} as const;

export const IDOL_TRANSLATION_REVIEWED_FIELD_PATHS = Object.freeze([
  "displayName",
  "shortBio",
  "fullBio",
  "seoTitle",
  "seoDescription",
] as const);

export const GIFT_TRANSLATION_REVIEWED_FIELD_PATHS = Object.freeze([
  "title",
  "subtitle",
  "shortDescription",
  "description",
  "fulfillmentDescription",
  "variantLabels",
  "safetyNotice",
  "seoTitle",
  "seoDescription",
] as const);

export const HOMEPAGE_TRANSLATION_REVIEWED_FIELD_PATHS = Object.freeze([
  "heroTitle",
  "heroSubtitle",
  "ctaLabel",
  "announcement",
  "slotLabels",
  "seoTitle",
  "seoDescription",
] as const);

export const POLICY_TRANSLATION_REVIEWED_FIELD_PATHS = Object.freeze([
  "title",
  "summary",
  "body",
] as const);

export const MEDIA_TRANSLATION_REVIEWED_FIELD_PATHS = Object.freeze([
  "alt",
  "title",
  "caption",
] as const);

const idolReviewedFieldPathsSchema = z.tuple([
  z.literal("displayName"),
  z.literal("shortBio"),
  z.literal("fullBio"),
  z.literal("seoTitle"),
  z.literal("seoDescription"),
]);

const giftReviewedFieldPathsSchema = z.tuple([
  z.literal("title"),
  z.literal("subtitle"),
  z.literal("shortDescription"),
  z.literal("description"),
  z.literal("fulfillmentDescription"),
  z.literal("variantLabels"),
  z.literal("safetyNotice"),
  z.literal("seoTitle"),
  z.literal("seoDescription"),
]);

const homepageReviewedFieldPathsSchema = z.tuple([
  z.literal("heroTitle"),
  z.literal("heroSubtitle"),
  z.literal("ctaLabel"),
  z.literal("announcement"),
  z.literal("slotLabels"),
  z.literal("seoTitle"),
  z.literal("seoDescription"),
]);

const policyReviewedFieldPathsSchema = z.tuple([
  z.literal("title"),
  z.literal("summary"),
  z.literal("body"),
]);

const mediaReviewedFieldPathsSchema = z.tuple([
  z.literal("alt"),
  z.literal("title"),
  z.literal("caption"),
]);

export const translationApprovalEvidenceSchema = z
  .discriminatedUnion("objectKind", [
    z.strictObject({
      ...approvalEvidenceBaseShape,
      objectKind: z.literal("IDOL"),
      translationRevisionId: translationRevisionIdSchema,
      idolRevisionId: idolRevisionIdSchema,
      reviewedFieldPaths: idolReviewedFieldPathsSchema,
    }),
    z.strictObject({
      ...approvalEvidenceBaseShape,
      objectKind: z.literal("GIFT"),
      translationRevisionId: translationRevisionIdSchema,
      giftRevisionId: giftRevisionIdSchema,
      reviewedFieldPaths: giftReviewedFieldPathsSchema,
    }),
    z.strictObject({
      ...approvalEvidenceBaseShape,
      objectKind: z.literal("HOMEPAGE"),
      translationRevisionId: homepageTranslationRevisionIdSchema,
      homepageRevisionId: homepageRevisionIdSchema,
      reviewedFieldPaths: homepageReviewedFieldPathsSchema,
    }),
    z.strictObject({
      ...approvalEvidenceBaseShape,
      objectKind: z.literal("POLICY"),
      translationRevisionId: policyTranslationRevisionIdSchema,
      policyRevisionId: policyRevisionIdSchema,
      reviewedFieldPaths: policyReviewedFieldPathsSchema,
    }),
    z.strictObject({
      ...approvalEvidenceBaseShape,
      objectKind: z.literal("MEDIA_METADATA"),
      translationRevisionId: translationRevisionIdSchema,
      mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
      reviewedFieldPaths: mediaReviewedFieldPathsSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (value.editorId.toLowerCase() === value.reviewerId.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "translation editor and reviewer must differ",
        path: ["reviewerId"],
      });
    }
    if (value.origin === "IMPORT" && value.importBatchId === undefined) {
      context.addIssue({
        code: "custom",
        message: "import approval evidence must retain its import batch id",
        path: ["importBatchId"],
      });
    }
    if (value.origin !== "IMPORT" && value.importBatchId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "only import approval evidence may carry an import batch id",
        path: ["importBatchId"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "approval evidence is append-only and stored separately from publication candidates",
      "approval binds one typed parent revision, translation revision, locale, source hash, and localized content hash",
      "approval binds translation origin and import batch provenance",
      "approval records the exact object-specific localized field set reviewed",
      "translation editor and reviewer differ",
    ],
  });

const translationPublicationManifestBaseShape = {
  schemaVersion: schemaVersionSchema,
  publicationId: contentPublicationIdSchema,
  approvalId: translationApprovalIdSchema,
  locale: supportedLocaleSchema,
  approvedSourceHash: sourceHashSchema,
  approvedContentHash: sourceHashSchema,
  origin: translationOriginSchema,
  importBatchId: z.uuid().optional(),
} as const;

export const translationPublicationManifestEntrySchema = z
  .discriminatedUnion("objectKind", [
    z.strictObject({
      ...translationPublicationManifestBaseShape,
      objectKind: z.literal("IDOL"),
      translationRevisionId: translationRevisionIdSchema,
      idolRevisionId: idolRevisionIdSchema,
    }),
    z.strictObject({
      ...translationPublicationManifestBaseShape,
      objectKind: z.literal("GIFT"),
      translationRevisionId: translationRevisionIdSchema,
      giftRevisionId: giftRevisionIdSchema,
    }),
    z.strictObject({
      ...translationPublicationManifestBaseShape,
      objectKind: z.literal("HOMEPAGE"),
      translationRevisionId: homepageTranslationRevisionIdSchema,
      homepageRevisionId: homepageRevisionIdSchema,
    }),
    z.strictObject({
      ...translationPublicationManifestBaseShape,
      objectKind: z.literal("POLICY"),
      translationRevisionId: policyTranslationRevisionIdSchema,
      policyRevisionId: policyRevisionIdSchema,
    }),
    z.strictObject({
      ...translationPublicationManifestBaseShape,
      objectKind: z.literal("MEDIA_METADATA"),
      translationRevisionId: translationRevisionIdSchema,
      mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (value.origin === "IMPORT" && value.importBatchId === undefined) {
      context.addIssue({
        code: "custom",
        message: "import manifest entries must retain their import batch id",
        path: ["importBatchId"],
      });
    }
    if (value.origin !== "IMPORT" && value.importBatchId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "only import manifest entries may carry an import batch id",
        path: ["importBatchId"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "entry is persisted inside one immutable content publication",
      "approval, typed parent revision, translation revision, locale, provenance, source hash, and localized content hash are bound together",
    ],
  });

type TranslationManifestLineageEntry = z.infer<
  typeof translationPublicationManifestEntrySchema
>;

function sourceLineageMismatches(
  entries: readonly TranslationManifestLineageEntry[],
): readonly TranslationManifestLineageEntry[] {
  const englishEntries = entries.filter((entry) => entry.locale === "en");
  if (englishEntries.length !== 1) {
    return [];
  }
  const currentEnglishSourceHash = englishEntries[0]!.approvedContentHash;
  return entries.filter(
    (entry) => entry.approvedSourceHash !== currentEnglishSourceHash,
  );
}

const publicationBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: contentPublicationIdSchema,
  action: z.enum(["PUBLISH", "ROLLBACK"]),
  replacesPublicationId: contentPublicationIdSchema.nullable(),
  translationManifest: z
    .array(translationPublicationManifestEntrySchema)
    .min(SUPPORTED_LOCALES.length),
  publishedBy: adminIdentityIdSchema,
  publishedAt: contentTimestampSchema,
} as const;

export const contentPublicationSchema = z
  .discriminatedUnion("objectKind", [
    z.strictObject({
      ...publicationBaseShape,
      objectKind: z.literal("IDOL"),
      idolId: idolIdSchema,
      idolRevisionId: idolRevisionIdSchema,
      mediaMetadataRevisionIds: z.array(mediaMetadataRevisionIdSchema).min(3),
    }),
    z.strictObject({
      ...publicationBaseShape,
      objectKind: z.literal("GIFT"),
      giftId: giftIdSchema,
      giftRevisionId: giftRevisionIdSchema,
      mediaMetadataRevisionIds: z.array(mediaMetadataRevisionIdSchema).min(1),
    }),
    z.strictObject({
      ...publicationBaseShape,
      objectKind: z.literal("HOMEPAGE"),
      homepageRevisionId: homepageRevisionIdSchema,
      mediaMetadataRevisionIds: z.array(mediaMetadataRevisionIdSchema).min(2),
    }),
    z.strictObject({
      ...publicationBaseShape,
      objectKind: z.literal("POLICY"),
      policyKey: policyKeySchema,
      policyRevisionId: policyRevisionIdSchema,
      mediaMetadataRevisionIds: z.array(mediaMetadataRevisionIdSchema).max(0),
    }),
  ])
  .superRefine((value, context) => {
    if (value.action === "ROLLBACK" && value.replacesPublicationId === null) {
      context.addIssue({
        code: "custom",
        message: "rollback must replace the current publication",
        path: ["replacesPublicationId"],
      });
    }
    if (
      value.replacesPublicationId !== null &&
      value.replacesPublicationId.toLowerCase() === value.id.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "a publication cannot replace itself",
        path: ["replacesPublicationId"],
      });
    }

    const approvalIds = new Set<string>();
    const translationRevisionIds = new Set<string>();
    for (const [index, entry] of value.translationManifest.entries()) {
      if (entry.publicationId.toLowerCase() !== value.id.toLowerCase()) {
        context.addIssue({
          code: "custom",
          message: "manifest entry must belong to this publication",
          path: ["translationManifest", index, "publicationId"],
        });
      }
      const approvalId = entry.approvalId.toLowerCase();
      if (approvalIds.has(approvalId)) {
        context.addIssue({
          code: "custom",
          message: "publication manifest approval ids must be unique",
          path: ["translationManifest", index, "approvalId"],
        });
      }
      approvalIds.add(approvalId);
      const translationRevisionId = entry.translationRevisionId.toLowerCase();
      if (translationRevisionIds.has(translationRevisionId)) {
        context.addIssue({
          code: "custom",
          message: "publication manifest translation revisions must be unique",
          path: ["translationManifest", index, "translationRevisionId"],
        });
      }
      translationRevisionIds.add(translationRevisionId);
    }

    const targetRevisionId =
      value.objectKind === "IDOL"
        ? value.idolRevisionId
        : value.objectKind === "GIFT"
          ? value.giftRevisionId
          : value.objectKind === "HOMEPAGE"
            ? value.homepageRevisionId
            : value.policyRevisionId;
    const mainEntries = value.translationManifest.filter(
      (entry) => entry.objectKind !== "MEDIA_METADATA",
    );
    const mainLocales = new Set<string>();
    for (const [index, entry] of mainEntries.entries()) {
      const parentRevisionId =
        entry.objectKind === "IDOL"
          ? entry.idolRevisionId
          : entry.objectKind === "GIFT"
            ? entry.giftRevisionId
            : entry.objectKind === "HOMEPAGE"
              ? entry.homepageRevisionId
              : entry.policyRevisionId;
      if (
        entry.objectKind !== value.objectKind ||
        parentRevisionId.toLowerCase() !== targetRevisionId.toLowerCase()
      ) {
        context.addIssue({
          code: "custom",
          message:
            "main translation manifest entry must match the published object and revision",
          path: ["translationManifest", index],
        });
      }
      if (mainLocales.has(entry.locale)) {
        context.addIssue({
          code: "custom",
          message: "main translation manifest locale must be unique",
          path: ["translationManifest", index, "locale"],
        });
      }
      mainLocales.add(entry.locale);
    }
    if (
      mainEntries.length !== SUPPORTED_LOCALES.length ||
      SUPPORTED_LOCALES.some((locale) => !mainLocales.has(locale))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "publication must bind exactly one main translation for every supported locale",
        path: ["translationManifest"],
      });
    }
    for (const entry of sourceLineageMismatches(mainEntries)) {
      context.addIssue({
        code: "custom",
        message:
          "manifest source lineage must point to the current approved English content",
        path: [
          "translationManifest",
          value.translationManifest.indexOf(entry),
          "approvedSourceHash",
        ],
      });
    }

    const declaredMediaRevisionIds = new Set<string>();
    for (const [
      index,
      revisionId,
    ] of value.mediaMetadataRevisionIds.entries()) {
      const normalizedRevisionId = revisionId.toLowerCase();
      if (declaredMediaRevisionIds.has(normalizedRevisionId)) {
        context.addIssue({
          code: "custom",
          message: "published media metadata revision ids must be unique",
          path: ["mediaMetadataRevisionIds", index],
        });
      }
      declaredMediaRevisionIds.add(normalizedRevisionId);
    }
    if (value.objectKind === "POLICY" && declaredMediaRevisionIds.size > 0) {
      context.addIssue({
        code: "custom",
        message:
          "policy publications cannot reference media metadata revisions",
        path: ["mediaMetadataRevisionIds"],
      });
    }

    const mediaEntriesByParent = new Map<
      string,
      typeof value.translationManifest
    >();
    for (const entry of value.translationManifest) {
      if (entry.objectKind !== "MEDIA_METADATA") {
        continue;
      }
      const normalizedRevisionId = entry.mediaMetadataRevisionId.toLowerCase();
      const group = mediaEntriesByParent.get(normalizedRevisionId) ?? [];
      group.push(entry);
      mediaEntriesByParent.set(normalizedRevisionId, group);
    }
    for (const [mediaMetadataRevisionId, entries] of mediaEntriesByParent) {
      if (!declaredMediaRevisionIds.has(mediaMetadataRevisionId)) {
        context.addIssue({
          code: "custom",
          message:
            "media translation manifest cannot reference undeclared metadata revisions",
          path: ["translationManifest"],
        });
      }
      const locales = new Set(entries.map((entry) => entry.locale));
      if (
        entries.length !== SUPPORTED_LOCALES.length ||
        SUPPORTED_LOCALES.some((locale) => !locales.has(locale))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "each media manifest must bind exactly one translation for every supported locale",
          path: ["translationManifest"],
        });
      }
      for (const entry of sourceLineageMismatches(entries)) {
        context.addIssue({
          code: "custom",
          message:
            "manifest source lineage must point to the current approved English content",
          path: [
            "translationManifest",
            value.translationManifest.indexOf(entry),
            "approvedSourceHash",
          ],
        });
      }
    }
    for (const mediaMetadataRevisionId of declaredMediaRevisionIds) {
      if (!mediaEntriesByParent.has(mediaMetadataRevisionId)) {
        context.addIssue({
          code: "custom",
          message:
            "every published media metadata revision requires a complete translation manifest",
          path: ["translationManifest"],
        });
      }
    }
  })
  .meta({
    "x-runtime-invariants": [
      "ROLLBACK is a new append-only publication event and replaces a prior publication",
      "PUBLISH may be the first publication or replace an existing publication",
      "a publication never replaces itself",
      "manifest entries are immutable, typed, publication-bound approval references",
      "the declared media metadata set exactly matches the media translation manifests",
      "main and every declared-media translation manifest contain the exact seven supported locales",
      "main and every declared-media translation manifest share the current approved English source lineage",
    ],
  });

type TranslationPublicationManifestEntryValue = z.infer<
  typeof translationPublicationManifestEntrySchema
>;
type ContentPublicationValue = z.infer<typeof contentPublicationSchema>;

function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

function publicationTargetRevisionId(
  publication: ContentPublicationValue,
): string {
  switch (publication.objectKind) {
    case "IDOL":
      return publication.idolRevisionId;
    case "GIFT":
      return publication.giftRevisionId;
    case "HOMEPAGE":
      return publication.homepageRevisionId;
    case "POLICY":
      return publication.policyRevisionId;
  }
}

function manifestParentRevisionId(
  entry: TranslationPublicationManifestEntryValue,
): string {
  switch (entry.objectKind) {
    case "IDOL":
      return entry.idolRevisionId;
    case "GIFT":
      return entry.giftRevisionId;
    case "HOMEPAGE":
      return entry.homepageRevisionId;
    case "POLICY":
      return entry.policyRevisionId;
    case "MEDIA_METADATA":
      return entry.mediaMetadataRevisionId;
  }
}

function manifestEntriesMatch(
  selected: TranslationPublicationManifestEntryValue,
  persisted: TranslationPublicationManifestEntryValue,
): boolean {
  return (
    selected.objectKind === persisted.objectKind &&
    canonicalUuid(selected.publicationId) ===
      canonicalUuid(persisted.publicationId) &&
    canonicalUuid(selected.approvalId) ===
      canonicalUuid(persisted.approvalId) &&
    canonicalUuid(selected.translationRevisionId) ===
      canonicalUuid(persisted.translationRevisionId) &&
    canonicalUuid(manifestParentRevisionId(selected)) ===
      canonicalUuid(manifestParentRevisionId(persisted)) &&
    selected.locale === persisted.locale &&
    selected.approvedSourceHash === persisted.approvedSourceHash &&
    selected.approvedContentHash === persisted.approvedContentHash &&
    selected.origin === persisted.origin &&
    (selected.importBatchId === undefined
      ? persisted.importBatchId === undefined
      : persisted.importBatchId !== undefined &&
        canonicalUuid(selected.importBatchId) ===
          canonicalUuid(persisted.importBatchId))
  );
}

const publicRevisionSelectionBaseShape = {
  schemaVersion: schemaVersionSchema,
  selectedRevisionLifecycle: catalogRevisionLifecycleStatusSchema,
  selectedTranslation: translationPublicationManifestEntrySchema,
  selectedMediaTranslations: z.array(translationPublicationManifestEntrySchema),
  currentPublication: contentPublicationSchema,
} as const;

export const publicRevisionSelectionSchema = z
  .discriminatedUnion("objectKind", [
    z.strictObject({
      ...publicRevisionSelectionBaseShape,
      objectKind: z.literal("IDOL"),
      idolId: idolIdSchema,
      operationalStatus: catalogOperationalStatusSchema,
      acceptingGifts: z.boolean(),
      publishedRevisionId: idolRevisionIdSchema.nullable(),
      selectedRevisionId: idolRevisionIdSchema,
    }),
    z.strictObject({
      ...publicRevisionSelectionBaseShape,
      objectKind: z.literal("GIFT"),
      giftId: giftIdSchema,
      operationalStatus: catalogOperationalStatusSchema,
      publishedRevisionId: giftRevisionIdSchema.nullable(),
      selectedRevisionId: giftRevisionIdSchema,
    }),
    z.strictObject({
      ...publicRevisionSelectionBaseShape,
      objectKind: z.literal("HOMEPAGE"),
      selectedRevisionId: homepageRevisionIdSchema,
    }),
    z.strictObject({
      ...publicRevisionSelectionBaseShape,
      objectKind: z.literal("POLICY"),
      policyKey: policyKeySchema,
      selectedRevisionId: policyRevisionIdSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (
      value.objectKind === "IDOL" &&
      value.acceptingGifts &&
      value.operationalStatus !== "active"
    ) {
      context.addIssue({
        code: "custom",
        message: "only active idols may accept gifts",
        path: ["acceptingGifts"],
      });
    }

    const currentPublication = value.currentPublication;
    if (currentPublication.objectKind !== value.objectKind) {
      context.addIssue({
        code: "custom",
        message:
          "current publication must have the same object kind as the selected revision",
        path: ["currentPublication", "objectKind"],
      });
    }
    if (
      canonicalUuid(publicationTargetRevisionId(currentPublication)) !==
      canonicalUuid(value.selectedRevisionId)
    ) {
      context.addIssue({
        code: "custom",
        message: "current publication must target the selected revision",
        path: ["currentPublication"],
      });
    }
    if (
      value.objectKind === "IDOL" &&
      currentPublication.objectKind === "IDOL" &&
      canonicalUuid(currentPublication.idolId) !== canonicalUuid(value.idolId)
    ) {
      context.addIssue({
        code: "custom",
        message: "current publication must belong to the selected idol",
        path: ["currentPublication", "idolId"],
      });
    }
    if (
      value.objectKind === "GIFT" &&
      currentPublication.objectKind === "GIFT" &&
      canonicalUuid(currentPublication.giftId) !== canonicalUuid(value.giftId)
    ) {
      context.addIssue({
        code: "custom",
        message: "current publication must belong to the selected gift",
        path: ["currentPublication", "giftId"],
      });
    }
    if (
      value.objectKind === "POLICY" &&
      currentPublication.objectKind === "POLICY" &&
      currentPublication.policyKey !== value.policyKey
    ) {
      context.addIssue({
        code: "custom",
        message: "current publication must belong to the selected policy",
        path: ["currentPublication", "policyKey"],
      });
    }

    const selectedTranslation = value.selectedTranslation;
    const selectedParentRevisionId =
      manifestParentRevisionId(selectedTranslation);
    if (
      selectedTranslation.objectKind !== value.objectKind ||
      canonicalUuid(selectedParentRevisionId) !==
        canonicalUuid(value.selectedRevisionId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "selected translation manifest must match the selected object revision",
        path: ["selectedTranslation"],
      });
    }
    if (
      canonicalUuid(selectedTranslation.publicationId) !==
      canonicalUuid(currentPublication.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "selected translation must belong to the current publication",
        path: ["selectedTranslation", "publicationId"],
      });
    }
    if (
      !currentPublication.translationManifest.some((persisted) =>
        manifestEntriesMatch(selectedTranslation, persisted),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "selected translation must exactly match an entry in the current publication manifest",
        path: ["selectedTranslation"],
      });
    }
    const selectedMediaTranslationIds = new Set<string>();
    const selectedMediaParentIds = new Set<string>();
    for (const [
      index,
      mediaTranslation,
    ] of value.selectedMediaTranslations.entries()) {
      if (
        mediaTranslation.objectKind !== "MEDIA_METADATA" ||
        canonicalUuid(mediaTranslation.publicationId) !==
          canonicalUuid(currentPublication.id)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "selected media translation must belong to the current publication",
          path: ["selectedMediaTranslations", index],
        });
      }
      if (mediaTranslation.locale !== selectedTranslation.locale) {
        context.addIssue({
          code: "custom",
          message:
            "selected media translation locale must match the object translation locale",
          path: ["selectedMediaTranslations", index, "locale"],
        });
      }
      const translationRevisionId =
        mediaTranslation.translationRevisionId.toLowerCase();
      if (selectedMediaTranslationIds.has(translationRevisionId)) {
        context.addIssue({
          code: "custom",
          message: "selected media translation revisions must be unique",
          path: ["selectedMediaTranslations", index, "translationRevisionId"],
        });
      }
      selectedMediaTranslationIds.add(translationRevisionId);
      if (mediaTranslation.objectKind === "MEDIA_METADATA") {
        selectedMediaParentIds.add(
          canonicalUuid(mediaTranslation.mediaMetadataRevisionId),
        );
      }
      if (
        !currentPublication.translationManifest.some((persisted) =>
          manifestEntriesMatch(mediaTranslation, persisted),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "selected media translation must exactly match an entry in the current publication manifest",
          path: ["selectedMediaTranslations", index],
        });
      }
    }
    const declaredMediaParentIds = new Set(
      currentPublication.mediaMetadataRevisionIds.map(canonicalUuid),
    );
    if (
      selectedMediaParentIds.size !== declaredMediaParentIds.size ||
      [...declaredMediaParentIds].some(
        (revisionId) => !selectedMediaParentIds.has(revisionId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "selected media translations must cover the exact media set from the current publication",
        path: ["selectedMediaTranslations"],
      });
    }
    if (
      value.objectKind === "POLICY" &&
      value.selectedMediaTranslations.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "policy projections do not select media translations",
        path: ["selectedMediaTranslations"],
      });
    }
  });

export const publicationIssueCodeSchema = z.enum([
  "SCHEMA_INVALID",
  "BASE_NOT_PUBLIC",
  "BASE_ARCHIVED",
  "REVISION_PARENT_MISMATCH",
  "REVISION_NOT_VALIDATED",
  "REVISION_LIFECYCLE_TIME_INVALID",
  "TARGET_OPERATIONAL_STATE_INVALID",
  "DRAFT_POINTER_MISMATCH",
  "PUBLISHED_POINTER_MISMATCH",
  "CURRENT_PUBLICATION_EVIDENCE_MISSING",
  "CURRENT_PUBLICATION_EVIDENCE_MISMATCH",
  "PUBLISH_TARGET_ALREADY_CURRENT",
  "ROLLBACK_TARGET_INVALID",
  "PUBLIC_REVISION_NOT_ELIGIBLE",
  "PUBLIC_VIEW_STATUS_MISMATCH",
  "PUBLIC_VIEW_IDENTITY_MISMATCH",
  "PUBLIC_VIEW_TRANSLATION_MISMATCH",
  "PUBLIC_VIEW_LOCALE_MISMATCH",
  "PUBLIC_VIEW_CONTENT_MISMATCH",
  "PUBLIC_VIEW_AVAILABILITY_MISMATCH",
  "TRANSLATION_MISSING",
  "TRANSLATION_DUPLICATE",
  "TRANSLATION_PARENT_MISMATCH",
  "TRANSLATION_NOT_APPROVED",
  "TRANSLATION_STALE",
  "TRANSLATION_CONTENT_HASH_MISMATCH",
  "TRANSLATION_APPROVAL_MISSING",
  "TRANSLATION_APPROVAL_DUPLICATE",
  "TRANSLATION_APPROVAL_MISMATCH",
  "ENGLISH_SOURCE_INVALID",
  "SAFETY_NOTICE_MISSING",
  "VARIANT_MISSING",
  "VARIANT_SELLABLE_MISSING",
  "VARIANT_DUPLICATE_ID",
  "VARIANT_DUPLICATE_SKU",
  "VARIANT_LABEL_MISMATCH",
  "ELIGIBILITY_MISSING",
  "ELIGIBLE_IDOL_NOT_PUBLISHED",
  "PRICE_MISSING",
  "PRICE_VARIANT_MISMATCH",
  "PRICE_BOOK_DUPLICATE",
  "PRICE_DUPLICATE",
  "PRICE_BOOK_NOT_PUBLISHED",
  "PRICE_NOT_EFFECTIVE",
  "PRICE_OVERLAP",
  "INVENTORY_ITEM_MISMATCH",
  "INVENTORY_ITEM_MISSING",
  "INVENTORY_BALANCE_ITEM_MISMATCH",
  "MEDIA_MISSING",
  "MEDIA_REFERENCE_PARENT_MISMATCH",
  "MEDIA_REQUIRED_ROLE_MISSING",
  "MEDIA_REQUIRED_ROLE_DUPLICATE",
  "MEDIA_REFERENCE_DUPLICATE",
  "MEDIA_SORT_ORDER_DUPLICATE",
  "MEDIA_GALLERY_LIMIT_EXCEEDED",
  "MEDIA_ASSET_DUPLICATE",
  "MEDIA_ASSET_CHECKSUM_DUPLICATE",
  "MEDIA_ASSET_MISSING",
  "MEDIA_METADATA_DUPLICATE",
  "MEDIA_METADATA_MISSING",
  "MEDIA_VARIANT_ID_DUPLICATE",
  "MEDIA_DERIVATIVE_DUPLICATE",
  "MEDIA_ASSET_NOT_READY",
  "MEDIA_RIGHTS_NOT_APPROVED",
  "MEDIA_METADATA_MISMATCH",
  "MEDIA_METADATA_NOT_PUBLISHABLE",
  "MEDIA_PRESENTATION_KIND_INVALID",
  "MEDIA_SOURCE_DIMENSIONS_INVALID",
  "MEDIA_SOURCE_ASPECT_RATIO_INVALID",
  "MEDIA_DERIVATIVE_MISSING",
  "MEDIA_DERIVATIVE_NOT_READY",
  "MEDIA_DERIVATIVE_USABLE_SIZE_MISSING",
  "MEDIA_DERIVATIVE_DIMENSIONS_INVALID",
  "MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID",
  "MEDIA_ALT_MISSING",
  "HOMEPAGE_SLOT_PARENT_MISMATCH",
  "HOMEPAGE_SLOT_DUPLICATE",
  "HOMEPAGE_HERO_INVALID",
  "HOMEPAGE_SLOT_LABEL_MISMATCH",
  "HOMEPAGE_REFERENCE_NOT_PUBLIC",
  "POLICY_NOT_EFFECTIVE",
  "POLICY_EFFECTIVE_TIME_INVALID",
  "IMPORT_MUST_BE_DRAFT",
  "OPTIONAL_FIELD_MISSING",
]);

export const publicationValidationIssueSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  severity: z.enum(["BLOCKER", "WARNING"]),
  code: publicationIssueCodeSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
});

export const publicationValidationReportSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    objectKind: z.enum(["IDOL", "GIFT", "HOMEPAGE", "POLICY"]),
    publishable: z.boolean(),
    issues: z.array(publicationValidationIssueSchema),
  })
  .superRefine((value, context) => {
    const hasBlocker = value.issues.some(
      (candidateIssue) => candidateIssue.severity === "BLOCKER",
    );
    if (value.publishable === hasBlocker) {
      context.addIssue({
        code: "custom",
        message: "publishable must be the inverse of blocker presence",
        path: ["publishable"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "publishable is true exactly when no BLOCKER issue exists",
    ],
  });

export type GiftPublicationCandidate = z.infer<
  typeof giftPublicationCandidateSchema
>;
export type IdolPublicationCandidate = z.infer<
  typeof idolPublicationCandidateSchema
>;
export type HomepagePublicationCandidate = z.infer<
  typeof homepagePublicationCandidateSchema
>;
export type PolicyPublicationCandidate = z.infer<
  typeof policyPublicationCandidateSchema
>;
export type ContentPublicationCandidate = z.infer<
  typeof contentPublicationCandidateSchema
>;
export type TranslationApprovalEvidence = z.infer<
  typeof translationApprovalEvidenceSchema
>;
export type TranslationPublicationManifestEntry = z.infer<
  typeof translationPublicationManifestEntrySchema
>;
export type ContentPublication = z.infer<typeof contentPublicationSchema>;
export type PublicRevisionSelection = z.infer<
  typeof publicRevisionSelectionSchema
>;
export type PublicationIssueCode = z.infer<typeof publicationIssueCodeSchema>;
export type PublicationValidationIssue = z.infer<
  typeof publicationValidationIssueSchema
>;
export type PublicationValidationReport = z.infer<
  typeof publicationValidationReportSchema
>;
