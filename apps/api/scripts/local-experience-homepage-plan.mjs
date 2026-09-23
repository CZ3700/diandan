import { localHomepageCopy } from "./local-experience-homepage-copy.mjs";
import { z } from "zod";
import {
  contentAuthoringContentSchema,
  homepageTranslationFieldsSchema,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";
import { giftStorefrontCopy } from "./gift-storefront-copy.mjs";

export const localHomepageSourceSchema = z.strictObject({
  idolId: z.uuid(),
  idolRevisionId: z.uuid(),
  displayName: z.string().min(1).max(80),
  desktopMediaAssetId: z.uuid(),
  desktopMediaMetadataRevisionId: z.uuid(),
  mobileMediaAssetId: z.uuid(),
  mobileMediaMetadataRevisionId: z.uuid(),
});

function homepageSeoTitle(name) {
  const maximum = homepageTranslationFieldsSchema.shape.seoTitle.maxLength;
  if (name.length <= maximum) return name;
  let title = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(name.trim())) {
    if (title.length + segment.length > maximum) break;
    title += segment;
  }
  // A single oversized combining cluster still gets an intact base code point.
  return title || [...name.trim()][0];
}

export function buildLocalHomepageContent(input) {
  const source = localHomepageSourceSchema.parse(input);
  const slots = [
    {
      slotKey: "hero",
      kind: "HERO_IDOL",
      idolId: source.idolId,
      desktopMediaAssetId: source.desktopMediaAssetId,
      desktopMediaMetadataRevisionId: source.desktopMediaMetadataRevisionId,
      mobileMediaAssetId: source.mobileMediaAssetId,
      mobileMediaMetadataRevisionId: source.mobileMediaMetadataRevisionId,
      sortOrder: 0,
    },
    {
      slotKey: "featured-artist",
      kind: "FEATURED_IDOL",
      idolId: source.idolId,
      sortOrder: 1,
    },
    {
      slotKey: "delivery-policy",
      kind: "POLICY_LINK",
      policyKey: "delivery",
      sortOrder: 2,
    },
  ];
  return contentAuthoringContentSchema.parse({
    kind: "HOMEPAGE",
    structure: { slots },
    translations: workspaceTranslations((locale) => ({
      heroTitle: source.displayName,
      heroSubtitle: giftStorefrontCopy[locale].subtitle,
      ctaLabel: localHomepageCopy(locale).cta,
      slotLabels: slots.map((slot) => ({
        slotKey: slot.slotKey,
        label:
          slot.kind === "POLICY_LINK"
            ? giftStorefrontCopy[locale].policyTitles[3]
            : source.displayName,
      })),
      seoTitle: homepageSeoTitle(source.displayName),
      seoDescription: giftStorefrontCopy[locale].subtitle,
    })),
  });
}
export function matchingLocalHomepage(actual, planned) {
  const normalize = (value) => ({
    ...value,
    structure: {
      slots: [...value.structure.slots].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    },
    translations: [...value.translations]
      .sort((a, b) => a.locale.localeCompare(b.locale))
      .map((row) => ({
        ...row,
        fields: {
          ...row.fields,
          slotLabels: [...row.fields.slotLabels].sort((a, b) =>
            a.slotKey.localeCompare(b.slotKey),
          ),
        },
      })),
  });
  return (
    actual.kind === "HOMEPAGE" &&
    planned.kind === "HOMEPAGE" &&
    canonicalPublicationValue(normalize(actual)) ===
      canonicalPublicationValue(normalize(planned))
  );
}
const metadataPlan = z.strictObject({
  content: contentAuthoringContentSchema.refine(
    (value) => value.kind === "MEDIA_METADATA",
  ),
  baseRevisionNumber: z.number().int().nonnegative(),
  baseHeadVersion: z.number().int().nonnegative(),
  revisionId: z.uuid().optional(),
  published: z.boolean().optional(),
});
const posterAssetsSchema = z.partialRecord(
  z.enum(["desktop", "mobile"]),
  z.strictObject({
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    uploadId: z.uuid().optional(),
    sourceAssetId: z.uuid().optional(),
    sourceMetadata: metadataPlan.optional(),
    jobId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    metadata: metadataPlan.optional(),
  }),
);
export const localHomepagePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    testOnly: z.literal(true),
    source: localHomepageSourceSchema,
    content: contentAuthoringContentSchema.refine(
      (value) => value.kind === "HOMEPAGE",
    ),
    revisionId: z.uuid().optional(),
    sessionIds: z.array(z.uuid()).max(2),
    retiredRevisionIds: z.array(z.uuid()).max(8).optional(),
    posterAssetVersion: z.literal(2).optional(),
    retiredPosterAssets: z.array(posterAssetsSchema).max(1).optional(),
    posterAssets: posterAssetsSchema.optional(),
    mediaPlans: z
      .partialRecord(z.enum(["desktop", "mobile"]), metadataPlan)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.content.kind === "HOMEPAGE" &&
      !matchingLocalHomepage(
        value.content,
        buildLocalHomepageContent(value.source),
      ) &&
      !(
        value.mediaPlans?.desktop?.published &&
        value.mediaPlans?.mobile?.published &&
        matchingLocalHomepage(
          value.content,
          buildLocalHomepageContent({
            ...value.source,
            desktopMediaMetadataRevisionId: value.mediaPlans.desktop.revisionId,
            mobileMediaMetadataRevisionId: value.mediaPlans.mobile.revisionId,
          }),
        )
      ) &&
      ![value.posterAssets, ...(value.retiredPosterAssets ?? [])].some(
        (assets) =>
          assets?.desktop?.metadata?.published &&
          assets?.mobile?.metadata?.published &&
          matchingLocalHomepage(
            value.content,
            buildLocalHomepageContent({
              ...value.source,
              desktopMediaAssetId: assets.desktop.assetId,
              desktopMediaMetadataRevisionId:
                assets.desktop.metadata.revisionId,
              mobileMediaAssetId: assets.mobile.assetId,
              mobileMediaMetadataRevisionId: assets.mobile.metadata.revisionId,
            }),
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Homepage bootstrap source and persisted plan differ",
      });
  });
