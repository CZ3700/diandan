import { z } from "zod";
import { contentLocaleContextSchema } from "./content-provenance.js";
import { dailyPublicationContextSchema } from "./daily-publication.js";
import {
  publishedIdolViewSchema,
  publishedGiftViewSchema,
  giftTranslationFieldsSchema,
} from "./catalog-content.js";
import {
  publishedHomepageViewSchema,
  publishedPolicyViewSchema,
  policyKeySchema,
} from "./content-models.js";
import { idolAliasSetSchema } from "./content-drafts.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
} from "./gift-details.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  mediaVariantIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publishedMediaViewSchema } from "./media-content.js";
import { publicationManifestRecordSchema } from "./publication-manifest.js";
import { publicationPreflightContextSchema } from "./publication-preflight.js";
import { publicMediaUrlSchema, slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const publishedContentLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("IDOL"), handle: slugSchema }),
  z.strictObject({ kind: z.literal("GIFT"), handle: slugSchema }),
  z.strictObject({ kind: z.literal("HOMEPAGE") }),
  z.strictObject({ kind: z.literal("POLICY"), policyKey: policyKeySchema }),
  z.strictObject({
    kind: z.literal("MEDIA_METADATA"),
    mediaAssetId: mediaAssetIdSchema,
  }),
]);
export const publishedContentReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  locator: publishedContentLocatorSchema,
  locale: supportedLocaleSchema,
});

const structure = giftDetailDocumentSchema.shape.blocks.element.options;
const fields = giftDetailTranslationFieldsSchema.shape.blocks.element.options;
const id = structure[0].shape.id;
function uniqueIdentities(
  rows: readonly { id: string }[],
  context: z.RefinementCtx,
) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    context.addIssue({
      code: "custom",
      message: "public detail identities must be unique",
    });
}
export const publishedGiftDetailBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id,
    kind: z.literal("HEADING"),
    level: structure[0].shape.level,
    text: fields[0].shape.text,
  }),
  z.strictObject({
    id,
    kind: z.literal("PARAGRAPH"),
    text: fields[1].shape.text,
  }),
  z.strictObject({
    id,
    kind: z.literal("LIST"),
    style: structure[2].shape.style,
    items: z
      .array(
        z.strictObject({ id, text: fields[2].shape.items.element.shape.text }),
      )
      .min(1)
      .max(24)
      .superRefine(uniqueIdentities),
  }),
  z.strictObject({
    id,
    kind: z.literal("SPECIFICATIONS"),
    items: z
      .array(
        z.strictObject({
          id,
          label: fields[3].shape.items.element.shape.label,
          value: fields[3].shape.items.element.shape.value,
        }),
      )
      .min(1)
      .max(24)
      .superRefine(uniqueIdentities),
  }),
  z.strictObject({
    id,
    kind: z.literal("MEDIA"),
    media: publishedMediaViewSchema,
    caption: fields[4].shape.caption,
  }),
]);
export const publishedGiftDetailsSchema = z.discriminatedUnion("format", [
  z.strictObject({
    format: z.literal("LEGACY_TEXT"),
    text: giftTranslationFieldsSchema.shape.description,
  }),
  z.strictObject({
    format: z.literal("BLOCKS"),
    blocks: z
      .array(publishedGiftDetailBlockSchema)
      .min(1)
      .max(32)
      .superRefine(uniqueIdentities),
  }),
]);
const idol = z
  .strictObject({
    kind: z.literal("IDOL"),
    view: publishedIdolViewSchema,
    aliases: idolAliasSetSchema.shape.aliases,
  })
  .superRefine((value, context) => {
    if (
      value.aliases.some(
        (alias) =>
          alias.locale !== null &&
          alias.locale !== value.view.localeContext.resolvedLocale,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["aliases"],
        message:
          "only resolved-locale and universal aliases are public in this response",
      });
  });
const gift = z
  .strictObject({
    kind: z.literal("GIFT"),
    view: publishedGiftViewSchema,
    details: publishedGiftDetailsSchema,
  })
  .superRefine((value, context) => {
    if (
      value.details.format === "LEGACY_TEXT" &&
      value.details.text !== value.view.description
    )
      context.addIssue({
        code: "custom",
        path: ["details", "text"],
        message: "legacy detail text must be the actual selected description",
      });
  });
export const publishedContentSchema = z.discriminatedUnion("kind", [
  idol,
  gift,
  z.strictObject({
    kind: z.literal("HOMEPAGE"),
    view: publishedHomepageViewSchema,
  }),
  z.strictObject({
    kind: z.literal("POLICY"),
    view: publishedPolicyViewSchema,
  }),
  z.strictObject({
    kind: z.literal("MEDIA_METADATA"),
    localeContext: contentLocaleContextSchema,
    view: publishedMediaViewSchema,
  }),
]);
export const publishedContentFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("FAILURE"),
  code: z.enum(["INVALID_QUERY", "NOT_FOUND", "CONTENT_UNAVAILABLE"]),
});
export const publishedContentResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("PUBLISHED_CONTENT"),
    publication: z.strictObject({
      id: z.uuid(),
      revisionId: z.uuid(),
      manifestHash: sourceHashSchema,
      publishedAt: contentTimestampSchema,
    }),
    content: publishedContentSchema,
  }),
  publishedContentFailureSchema,
]);
export const legacyPublishedContentContextSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  locale: supportedLocaleSchema,
  publication: publicationManifestRecordSchema,
  canonical: publicationPreflightContextSchema,
  media: z.array(
    z.strictObject({
      mediaAssetId: mediaAssetIdSchema,
      mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
      mediaVariantId: mediaVariantIdSchema,
      url: publicMediaUrlSchema,
    }),
  ),
});
export const publishedContentContextSchema = z.union([
  legacyPublishedContentContextSchema,
  dailyPublicationContextSchema,
]);
export type LegacyPublishedContentContext = z.infer<
  typeof legacyPublishedContentContextSchema
>;
export const legacyPublishedContentContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    context: legacyPublishedContentContextSchema,
  }),
  publishedContentFailureSchema,
]);
export const publishedContentContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    context: publishedContentContextSchema,
  }),
  publishedContentFailureSchema,
]);

export type PublishedContentLocator = z.infer<
  typeof publishedContentLocatorSchema
>;
export type PublishedContentReadCommand = z.infer<
  typeof publishedContentReadCommandSchema
>;
export type PublishedGiftDetailBlock = z.infer<
  typeof publishedGiftDetailBlockSchema
>;
export type PublishedGiftDetails = z.infer<typeof publishedGiftDetailsSchema>;
export type PublishedContent = z.infer<typeof publishedContentSchema>;
export type PublishedContentFailure = z.infer<
  typeof publishedContentFailureSchema
>;
export type PublishedContentResponse = z.infer<
  typeof publishedContentResponseSchema
>;
export type PublishedContentContext = z.infer<
  typeof publishedContentContextSchema
>;
export type PublishedContentContextResponse = z.infer<
  typeof publishedContentContextResponseSchema
>;
