import { z } from "zod";
import {
  priceBookRevisionSchema,
  priceSchema,
} from "./pricing-inventory-content.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import {
  giftRevisionSchema,
  giftTranslationFieldsSchema,
  giftVariantDefinitionSchema,
  idolRevisionSchema,
  idolTranslationFieldsSchema,
} from "./catalog-content.js";
import {
  homepageSlotSchema,
  homepageTranslationFieldsSchema,
} from "./content-models.js";
import {
  contentTimestampSchema,
  createRequiredTextSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  mediaAssetSchema,
  mediaFocalPointSchema,
  mediaVariantSchema,
} from "./media-content.js";
import {
  publicationManifestAssetSchema,
  publicationManifestMediaLineageSchema,
  publicationManifestVariantSchema,
} from "./publication-manifest.js";
import { publicationPreflightMediaLineageSchema } from "./publication-preflight.js";
import { publicMediaUrlSchema, slugSchema } from "./presentation.js";

const uuid = z.uuid();
const base = {
  schemaVersion: z.literal(3),
  ownerId: uuid,
  revisionId: uuid,
  revisionNumber: z.number().int().positive(),
  createdBy: uuid,
  createdAt: contentTimestampSchema,
};
function source<F extends z.ZodType>(fields: F) {
  return z.strictObject({
    id: uuid,
    locale: supportedLocaleSchema,
    sourceHash: sourceHashSchema,
    editorId: uuid,
    editedAt: contentTimestampSchema,
    fields,
  });
}
const reference = z.strictObject({
  role: z.enum([
    "PORTRAIT",
    "HERO_DESKTOP",
    "HERO_MOBILE",
    "PRIMARY",
    "GALLERY",
  ]),
  mediaAssetId: uuid,
  mediaMetadataRevisionId: uuid,
  sortOrder: z.number().int().nonnegative(),
});
const media = z.array(reference).max(15);
export const dailyMediaMetadataDocumentSchema = z.strictObject({
  ...base,
  kind: z.literal("MEDIA_METADATA"),
  source: source(z.strictObject({ alt: z.string().min(1).max(300) })),
  structure: z.strictObject({
    presentationKind: z.literal("INFORMATIVE"),
    focalPoint: mediaFocalPointSchema,
  }),
});
/** No review fields: this is an explicitly authorized original, never a fabricated translation package. */
export const dailyPublicationDocumentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...base,
    kind: z.literal("IDOL"),
    source: source(
      idolTranslationFieldsSchema.extend({
        fullBio: createRequiredTextSchema(600),
      }),
    ),
    structure: idolRevisionSchema.pick({
      themeAccent: true,
      heroTextTone: true,
      displayOrder: true,
    }),
    media,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("GIFT"),
    giftKind: giftKindSchema,
    source: source(
      giftTranslationFieldsSchema.extend({
        fulfillmentDescription:
          giftTranslationFieldsSchema.shape.fulfillmentDescription.optional(),
      }),
    ),
    structure: giftRevisionSchema
      .pick({ category: true, requiresSafetyNotice: true, shippingMode: true })
      .extend({
        contents: z.array(giftRevisionSchema.shape.contents.element).max(32),
        deliveryEstimate: giftRevisionSchema.shape.deliveryEstimate.optional(),
      }),
    variants: z.array(giftVariantDefinitionSchema).min(1).max(64),
    media,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("HOMEPAGE"),
    source: source(homepageTranslationFieldsSchema),
    slots: z.array(homepageSlotSchema).min(1).max(32),
  }),
  dailyMediaMetadataDocumentSchema,
]);
const frozenMedia = z.strictObject({
  metadata: dailyMediaMetadataDocumentSchema,
  asset: publicationManifestAssetSchema,
  variants: z.array(publicationManifestVariantSchema).min(1),
  lineage: publicationManifestMediaLineageSchema,
});
export const dailyPublicationManifestSchema = z.strictObject({
  schemaVersion: z.literal(3),
  publicationMode: z.literal("DIRECT_OPERATOR_V1"),
  operationId: uuid,
  actorId: uuid,
  document: dailyPublicationDocumentSchema,
  media: z.array(frozenMedia).max(15),
});
export const dailyPublicationCurrentMediaSchema = z.strictObject({
  metadata: dailyMediaMetadataDocumentSchema,
  lifecycle: z.enum([
    "DRAFT",
    "VALIDATED",
    "PUBLISHED",
    "SUPERSEDED",
    "ARCHIVED",
  ]),
  asset: mediaAssetSchema,
  variants: z.array(mediaVariantSchema),
  lineage: publicationPreflightMediaLineageSchema,
  selectedVariantId: uuid,
  url: publicMediaUrlSchema,
});
/** Current rows are reloaded under the caller's consistent transaction; the manifest is not authorization. */
export const dailyPublicationContextSchema = z.strictObject({
  schemaVersion: z.literal(3),
  publicationMode: z.literal("DIRECT_OPERATOR_V1"),
  locale: supportedLocaleSchema,
  publication: z.strictObject({
    publicationId: uuid,
    revisionId: uuid,
    headVersion: z.number().int().positive(),
    publishedAt: contentTimestampSchema,
    manifestHash: sourceHashSchema,
  }),
  manifest: dailyPublicationManifestSchema,
  current: z.strictObject({
    publicationId: uuid,
    revisionId: uuid,
    headVersion: z.number().int().positive(),
    evaluatedAt: contentTimestampSchema,
    lifecycle: z.enum([
      "DRAFT",
      "VALIDATED",
      "PUBLISHED",
      "SUPERSEDED",
      "ARCHIVED",
    ]),
    status: z.enum(["draft", "active", "paused", "archived"]),
    handle: slugSchema.nullable(),
    acceptingGifts: z.boolean(),
    document: dailyPublicationDocumentSchema,
    media: z.array(dailyPublicationCurrentMediaSchema).max(15),
    prices: z.array(priceSchema),
    priceBooks: z.array(priceBookRevisionSchema),
    variants: z.array(giftVariantDefinitionSchema).max(64),
  }),
});
export type DailyPublicationDocument = z.infer<
  typeof dailyPublicationDocumentSchema
>;
export type DailyMediaMetadataDocument = z.infer<
  typeof dailyMediaMetadataDocumentSchema
>;
export type DailyPublicationManifest = z.infer<
  typeof dailyPublicationManifestSchema
>;
export type DailyPublicationCurrentMedia = z.infer<
  typeof dailyPublicationCurrentMediaSchema
>;
export type DailyPublicationContext = z.infer<
  typeof dailyPublicationContextSchema
>;
