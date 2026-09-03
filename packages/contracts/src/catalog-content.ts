import { z } from "zod";

import {
  catalogOperationalStatusSchema,
  publicCatalogOperationalStatusSchema,
} from "./catalog.js";
import {
  contentTimestampSchema,
  createControlledRichTextSchema,
  createRequiredTextSchema,
  positiveRevisionSchema,
  revisionLifecycleSchema,
  translationAuditShape,
  validateTranslationAudit,
} from "./content-lifecycle.js";
import {
  adminIdentityIdSchema,
  giftIdSchema,
  giftRevisionIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  idolRevisionIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { localeContextSchema } from "./locale.js";
import { publishedMediaViewSchema } from "./media-content.js";
import { slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

const positiveVersionSchema = z.number().int().positive();

export const idolBaseSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: idolIdSchema,
    handle: slugSchema,
    status: catalogOperationalStatusSchema,
    acceptingGifts: z.boolean(),
    draftRevisionId: idolRevisionIdSchema.nullable(),
    publishedRevisionId: idolRevisionIdSchema.nullable(),
    version: positiveVersionSchema,
  })
  .superRefine((value, context) => {
    if (value.acceptingGifts && value.status !== "active") {
      context.addIssue({
        code: "custom",
        message: "only active idols may accept new gifts",
        path: ["acceptingGifts"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "acceptingGifts=true requires operational status active",
    ],
  });

export const idolRevisionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: idolRevisionIdSchema,
  idolId: idolIdSchema,
  revision: positiveRevisionSchema,
  lifecycle: revisionLifecycleSchema,
  themeAccent: z.string().regex(/^#[A-Fa-f0-9]{6}$/u),
  heroTextTone: z.enum(["light", "dark"]),
  displayOrder: z.number().int().nonnegative(),
  createdBy: adminIdentityIdSchema,
  createdAt: contentTimestampSchema,
});

export const idolTranslationFieldsSchema = z.strictObject({
  displayName: createRequiredTextSchema(40),
  shortBio: createRequiredTextSchema(160),
  fullBio: createControlledRichTextSchema(600),
  seoTitle: createRequiredTextSchema(60),
  seoDescription: createRequiredTextSchema(155),
});

export const idolRevisionTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: translationRevisionIdSchema,
    idolRevisionId: idolRevisionIdSchema,
    ...translationAuditShape,
    ...idolTranslationFieldsSchema.shape,
  })
  .superRefine(validateTranslationAudit)
  .meta({
    "x-runtime-invariants": [
      "English sourceHash equals translatedFromSourceHash",
      "APPROVED evidence binds the current source and localized content hashes",
      "editor and reviewer differ",
    ],
  });

export const idolRevisionMediaSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  idolRevisionId: idolRevisionIdSchema,
  role: z.enum(["PORTRAIT", "HERO_DESKTOP", "HERO_MOBILE", "GALLERY"]),
  mediaAssetId: mediaAssetIdSchema,
  mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
  sortOrder: z.number().int().nonnegative(),
});

export const giftBaseSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftIdSchema,
  handle: slugSchema,
  status: catalogOperationalStatusSchema,
  draftRevisionId: giftRevisionIdSchema.nullable(),
  publishedRevisionId: giftRevisionIdSchema.nullable(),
  version: positiveVersionSchema,
});

export const giftCategorySchema = z.enum([
  "FLOWERS",
  "FOOD",
  "BEAUTY",
  "ACCESSORY",
  "OTHER",
]);

export const deliveryEstimateSchema = z
  .strictObject({
    minimum: z.number().int().positive(),
    maximum: z.number().int().positive(),
    unit: z.enum(["DAY", "WEEK"]),
  })
  .superRefine((value, context) => {
    if (value.minimum > value.maximum) {
      context.addIssue({
        code: "custom",
        message: "delivery estimate minimum cannot exceed maximum",
        path: ["maximum"],
      });
    }
  });

const giftContentComponentSchema = z.strictObject({
  componentCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/u),
  quantity: z.number().int().positive(),
  unit: z.enum(["ITEM", "GRAM", "MILLILITER"]),
});

export const giftRevisionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftRevisionIdSchema,
  giftId: giftIdSchema,
  revision: positiveRevisionSchema,
  lifecycle: revisionLifecycleSchema,
  category: giftCategorySchema,
  contents: z.array(giftContentComponentSchema).min(1).max(32),
  deliveryEstimate: deliveryEstimateSchema,
  requiresSafetyNotice: z.boolean(),
  shippingMode: z.literal("internal_to_idol"),
  createdBy: adminIdentityIdSchema,
  createdAt: contentTimestampSchema,
});

export const giftTranslationFieldsSchema = z.strictObject({
  title: createRequiredTextSchema(160),
  subtitle: createRequiredTextSchema(80).optional(),
  shortDescription: createRequiredTextSchema(160),
  description: createRequiredTextSchema(600),
  fulfillmentDescription: createRequiredTextSchema(600),
  variantLabels: z
    .array(
      z.strictObject({
        giftVariantId: giftVariantIdSchema,
        label: createRequiredTextSchema(80),
      }),
    )
    .min(1)
    .max(64),
  safetyNotice: createRequiredTextSchema(600).optional(),
  seoTitle: createRequiredTextSchema(60),
  seoDescription: createRequiredTextSchema(155),
});

export const giftRevisionTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: translationRevisionIdSchema,
    giftRevisionId: giftRevisionIdSchema,
    ...translationAuditShape,
    ...giftTranslationFieldsSchema.shape,
  })
  .superRefine(validateTranslationAudit)
  .meta({
    "x-runtime-invariants": [
      "English sourceHash equals translatedFromSourceHash",
      "APPROVED evidence binds the current source and localized content hashes",
      "editor and reviewer differ",
    ],
  });

export const giftVariantDefinitionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftVariantIdSchema,
  giftId: giftIdSchema,
  sku: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u),
  status: catalogOperationalStatusSchema,
  inventoryPolicy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
});

export const giftVariantIdolEligibilitySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  giftVariantId: giftVariantIdSchema,
  idolId: idolIdSchema,
  eligible: z.literal(true),
});

export const giftRevisionMediaSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  giftRevisionId: giftRevisionIdSchema,
  role: z.enum(["PRIMARY", "GALLERY"]),
  mediaAssetId: mediaAssetIdSchema,
  mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
  sortOrder: z.number().int().nonnegative(),
});

const publishedGallerySchema = z.array(publishedMediaViewSchema).max(12);

const publishedGiftVariantSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftVariantIdSchema,
  label: createRequiredTextSchema(80),
  status: publicCatalogOperationalStatusSchema,
  inventoryPolicy: giftVariantDefinitionSchema.shape.inventoryPolicy,
});

export const publishedIdolViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: idolIdSchema,
    handle: slugSchema,
    status: publicCatalogOperationalStatusSchema,
    acceptingGifts: z.boolean(),
    localeContext: localeContextSchema,
    ...idolTranslationFieldsSchema.shape,
    themeAccent: idolRevisionSchema.shape.themeAccent,
    heroTextTone: idolRevisionSchema.shape.heroTextTone,
    portrait: publishedMediaViewSchema,
    heroDesktop: publishedMediaViewSchema,
    heroMobile: publishedMediaViewSchema,
    gallery: publishedGallerySchema,
  })
  .superRefine((value, context) => {
    if (value.status === "paused" && value.acceptingGifts) {
      context.addIssue({
        code: "custom",
        message: "paused idols cannot accept new gifts",
        path: ["acceptingGifts"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "paused idols remain visible but acceptingGifts must be false",
      "all media are public projections without storage object keys",
    ],
  });

export const publishedGiftViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: giftIdSchema,
    handle: slugSchema,
    status: publicCatalogOperationalStatusSchema,
    localeContext: localeContextSchema,
    title: giftTranslationFieldsSchema.shape.title,
    subtitle: giftTranslationFieldsSchema.shape.subtitle,
    shortDescription: giftTranslationFieldsSchema.shape.shortDescription,
    description: giftTranslationFieldsSchema.shape.description,
    fulfillmentDescription:
      giftTranslationFieldsSchema.shape.fulfillmentDescription,
    category: giftRevisionSchema.shape.category,
    contents: giftRevisionSchema.shape.contents,
    deliveryEstimate: deliveryEstimateSchema,
    shippingMode: giftRevisionSchema.shape.shippingMode,
    primaryMedia: publishedMediaViewSchema,
    gallery: publishedGallerySchema,
    variants: z.array(publishedGiftVariantSchema).min(1).max(64),
    safetyNotice: giftTranslationFieldsSchema.shape.safetyNotice,
    seoTitle: giftTranslationFieldsSchema.shape.seoTitle,
    seoDescription: giftTranslationFieldsSchema.shape.seoDescription,
  })
  .superRefine((value, context) => {
    if (
      value.status === "active" &&
      !value.variants.some((variant) => variant.status === "active")
    ) {
      context.addIssue({
        code: "custom",
        message: "active gifts require at least one active variant",
        path: ["variants"],
      });
    }
  });

export type IdolBase = z.infer<typeof idolBaseSchema>;
export type IdolRevision = z.infer<typeof idolRevisionSchema>;
export type IdolTranslationFields = z.infer<typeof idolTranslationFieldsSchema>;
export type IdolRevisionTranslation = z.infer<
  typeof idolRevisionTranslationSchema
>;
export type IdolRevisionMedia = z.infer<typeof idolRevisionMediaSchema>;
export type GiftBase = z.infer<typeof giftBaseSchema>;
export type GiftRevision = z.infer<typeof giftRevisionSchema>;
export type GiftTranslationFields = z.infer<typeof giftTranslationFieldsSchema>;
export type GiftRevisionTranslation = z.infer<
  typeof giftRevisionTranslationSchema
>;
export type GiftVariantDefinition = z.infer<typeof giftVariantDefinitionSchema>;
export type GiftVariantIdolEligibility = z.infer<
  typeof giftVariantIdolEligibilitySchema
>;
export type GiftRevisionMedia = z.infer<typeof giftRevisionMediaSchema>;
export type PublishedIdolView = z.infer<typeof publishedIdolViewSchema>;
export type PublishedGiftView = z.infer<typeof publishedGiftViewSchema>;
