import { z } from "zod";

import {
  giftBaseSchema,
  giftRevisionMediaSchema,
  giftRevisionSchema,
  giftRevisionTranslationSchema,
  giftVariantDefinitionSchema,
  idolBaseSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
} from "./catalog-content.js";
import {
  homepageRevisionSchema,
  homepageRevisionTranslationSchema,
  homepageSlotSchema,
  policyRevisionSchema,
  policyRevisionTranslationSchema,
} from "./content-models.js";
import {
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
} from "./identifiers.js";
import { localeContextSchema } from "./locale.js";
import {
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
} from "./media-content.js";
import { publicMediaUrlSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const publicMediaProjectionSourceSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  mediaAssetId: mediaAssetIdSchema,
  mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
  asset: mediaAssetSchema,
  variant: mediaVariantSchema,
  metadataRevision: mediaMetadataRevisionSchema,
  translation: mediaMetadataRevisionTranslationSchema,
  url: publicMediaUrlSchema,
});

const publicProjectionSourceBaseShape = {
  schemaVersion: schemaVersionSchema,
  localeContext: localeContextSchema,
} as const;

export const idolPublicProjectionSourceSchema = z.strictObject({
  ...publicProjectionSourceBaseShape,
  objectKind: z.literal("IDOL"),
  base: idolBaseSchema,
  revision: idolRevisionSchema,
  translation: idolRevisionTranslationSchema,
  mediaReferences: z.array(idolRevisionMediaSchema),
  media: z.array(publicMediaProjectionSourceSchema),
});

export const giftPublicProjectionSourceSchema = z.strictObject({
  ...publicProjectionSourceBaseShape,
  objectKind: z.literal("GIFT"),
  base: giftBaseSchema,
  revision: giftRevisionSchema,
  translation: giftRevisionTranslationSchema,
  variants: z.array(giftVariantDefinitionSchema),
  mediaReferences: z.array(giftRevisionMediaSchema),
  media: z.array(publicMediaProjectionSourceSchema),
});

export const homepagePublicProjectionSourceSchema = z.strictObject({
  ...publicProjectionSourceBaseShape,
  objectKind: z.literal("HOMEPAGE"),
  revision: homepageRevisionSchema,
  translation: homepageRevisionTranslationSchema,
  slots: z.array(homepageSlotSchema),
  media: z.array(publicMediaProjectionSourceSchema),
});

export const policyPublicProjectionSourceSchema = z.strictObject({
  ...publicProjectionSourceBaseShape,
  objectKind: z.literal("POLICY"),
  revision: policyRevisionSchema,
  translation: policyRevisionTranslationSchema,
});

export const publicProjectionSourceSchema = z.discriminatedUnion("objectKind", [
  idolPublicProjectionSourceSchema,
  giftPublicProjectionSourceSchema,
  homepagePublicProjectionSourceSchema,
  policyPublicProjectionSourceSchema,
]);

export type PublicMediaProjectionSource = z.infer<
  typeof publicMediaProjectionSourceSchema
>;
export type IdolPublicProjectionSource = z.infer<
  typeof idolPublicProjectionSourceSchema
>;
export type GiftPublicProjectionSource = z.infer<
  typeof giftPublicProjectionSourceSchema
>;
export type HomepagePublicProjectionSource = z.infer<
  typeof homepagePublicProjectionSourceSchema
>;
export type PolicyPublicProjectionSource = z.infer<
  typeof policyPublicProjectionSourceSchema
>;
export type PublicProjectionSource = z.infer<
  typeof publicProjectionSourceSchema
>;
