import { z } from "zod";

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
  homepageRevisionIdSchema,
  homepageTranslationRevisionIdSchema,
  idolIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  policyRevisionIdSchema,
  policyTranslationRevisionIdSchema,
} from "./identifiers.js";
import { localeContextSchema } from "./locale.js";
import { publishedMediaViewSchema } from "./media-content.js";
import { schemaVersionSchema } from "./versioning.js";

const slotKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

export const homepageSlotSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      homepageRevisionId: homepageRevisionIdSchema,
      slotKey: slotKeySchema,
      kind: z.literal("HERO_IDOL"),
      idolId: idolIdSchema,
      desktopMediaAssetId: mediaAssetIdSchema,
      desktopMediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
      mobileMediaAssetId: mediaAssetIdSchema,
      mobileMediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
      sortOrder: z.number().int().nonnegative(),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      homepageRevisionId: homepageRevisionIdSchema,
      slotKey: slotKeySchema,
      kind: z.literal("FEATURED_IDOL"),
      idolId: idolIdSchema,
      sortOrder: z.number().int().nonnegative(),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      homepageRevisionId: homepageRevisionIdSchema,
      slotKey: slotKeySchema,
      kind: z.literal("FEATURED_GIFT"),
      giftId: giftIdSchema,
      sortOrder: z.number().int().nonnegative(),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      homepageRevisionId: homepageRevisionIdSchema,
      slotKey: slotKeySchema,
      kind: z.literal("POLICY_LINK"),
      policyKey: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
      sortOrder: z.number().int().nonnegative(),
    }),
  ])
  .superRefine((value, context) => {
    if (value.kind !== "HERO_IDOL") {
      return;
    }
    if (
      value.desktopMediaAssetId.toLowerCase() ===
      value.mobileMediaAssetId.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "desktop and mobile hero assets must be distinct",
        path: ["mobileMediaAssetId"],
      });
    }
    if (
      value.desktopMediaMetadataRevisionId.toLowerCase() ===
      value.mobileMediaMetadataRevisionId.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "desktop and mobile hero metadata must be distinct",
        path: ["mobileMediaMetadataRevisionId"],
      });
    }
  });

export const homepageRevisionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: homepageRevisionIdSchema,
  revision: positiveRevisionSchema,
  lifecycle: revisionLifecycleSchema,
  createdBy: adminIdentityIdSchema,
  createdAt: contentTimestampSchema,
});

const homepageSlotLabelSchema = z.strictObject({
  slotKey: slotKeySchema,
  label: createRequiredTextSchema(80),
});

export const homepageTranslationFieldsSchema = z.strictObject({
  heroTitle: createRequiredTextSchema(120),
  heroSubtitle: createRequiredTextSchema(240),
  ctaLabel: createRequiredTextSchema(80),
  announcement: createRequiredTextSchema(240).optional(),
  slotLabels: z.array(homepageSlotLabelSchema).min(1).max(32),
  seoTitle: createRequiredTextSchema(60),
  seoDescription: createRequiredTextSchema(155),
});

export const homepageRevisionTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: homepageTranslationRevisionIdSchema,
    homepageRevisionId: homepageRevisionIdSchema,
    ...translationAuditShape,
    ...homepageTranslationFieldsSchema.shape,
  })
  .superRefine(validateTranslationAudit);

export const policyKindSchema = z.enum([
  "TERMS",
  "PRIVACY",
  "REFUND",
  "DELIVERY",
]);

export const policyKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

export const policyRevisionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: policyRevisionIdSchema,
  policyKey: policyKeySchema,
  kind: policyKindSchema,
  revision: positiveRevisionSchema,
  lifecycle: revisionLifecycleSchema,
  effectiveAt: contentTimestampSchema,
  createdBy: adminIdentityIdSchema,
  createdAt: contentTimestampSchema,
});

export const policyTranslationFieldsSchema = z.strictObject({
  title: createRequiredTextSchema(160),
  summary: createRequiredTextSchema(300),
  body: createControlledRichTextSchema(20_000),
});

export const policyRevisionTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: policyTranslationRevisionIdSchema,
    policyRevisionId: policyRevisionIdSchema,
    ...translationAuditShape,
    ...policyTranslationFieldsSchema.shape,
  })
  .superRefine(validateTranslationAudit);

const publishedHomepageSlotBaseShape = {
  schemaVersion: schemaVersionSchema,
  slotKey: slotKeySchema,
  label: createRequiredTextSchema(80),
  sortOrder: z.number().int().nonnegative(),
} as const;

export const publishedHomepageSlotSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...publishedHomepageSlotBaseShape,
    kind: z.literal("HERO_IDOL"),
    idolId: idolIdSchema,
  }),
  z.strictObject({
    ...publishedHomepageSlotBaseShape,
    kind: z.literal("FEATURED_IDOL"),
    idolId: idolIdSchema,
  }),
  z.strictObject({
    ...publishedHomepageSlotBaseShape,
    kind: z.literal("FEATURED_GIFT"),
    giftId: giftIdSchema,
  }),
  z.strictObject({
    ...publishedHomepageSlotBaseShape,
    kind: z.literal("POLICY_LINK"),
    policyKey: policyKeySchema,
  }),
]);

export const publishedHomepageViewSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  localeContext: localeContextSchema,
  heroTitle: homepageTranslationFieldsSchema.shape.heroTitle,
  heroSubtitle: homepageTranslationFieldsSchema.shape.heroSubtitle,
  ctaLabel: homepageTranslationFieldsSchema.shape.ctaLabel,
  announcement: homepageTranslationFieldsSchema.shape.announcement,
  heroDesktop: publishedMediaViewSchema,
  heroMobile: publishedMediaViewSchema,
  slots: z.array(publishedHomepageSlotSchema).min(1).max(32),
  seoTitle: homepageTranslationFieldsSchema.shape.seoTitle,
  seoDescription: homepageTranslationFieldsSchema.shape.seoDescription,
});

export const publishedPolicyViewSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  policyKey: policyKeySchema,
  kind: policyKindSchema,
  localeContext: localeContextSchema,
  title: policyTranslationFieldsSchema.shape.title,
  summary: policyTranslationFieldsSchema.shape.summary,
  body: policyTranslationFieldsSchema.shape.body,
  effectiveAt: contentTimestampSchema,
});

export type HomepageSlot = z.infer<typeof homepageSlotSchema>;
export type HomepageRevision = z.infer<typeof homepageRevisionSchema>;
export type HomepageTranslationFields = z.infer<
  typeof homepageTranslationFieldsSchema
>;
export type HomepageRevisionTranslation = z.infer<
  typeof homepageRevisionTranslationSchema
>;
export type PolicyRevision = z.infer<typeof policyRevisionSchema>;
export type PolicyTranslationFields = z.infer<
  typeof policyTranslationFieldsSchema
>;
export type PolicyRevisionTranslation = z.infer<
  typeof policyRevisionTranslationSchema
>;
export type PublishedHomepageView = z.infer<typeof publishedHomepageViewSchema>;
export type PublishedHomepageSlot = z.infer<typeof publishedHomepageSlotSchema>;
export type PublishedPolicyView = z.infer<typeof publishedPolicyViewSchema>;
