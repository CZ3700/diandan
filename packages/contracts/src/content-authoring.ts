import { z } from "zod";
import {
  adminContentFailureSchema,
  adminMutationResponseSchema,
  adminContentRequestSchema,
} from "./admin-content.js";
import {
  idolRevisionSchema,
  giftRevisionSchema,
  idolTranslationFieldsSchema,
  giftTranslationFieldsSchema,
  idolRevisionMediaSchema,
  giftRevisionMediaSchema,
} from "./catalog-content.js";
import {
  homepageSlotSchema,
  policyRevisionSchema,
  homepageTranslationFieldsSchema,
  policyTranslationFieldsSchema,
  policyKeySchema,
} from "./content-models.js";
import { mediaMetadataRevisionSchema } from "./media-content.js";
import {
  contentTimestampSchema,
  createRequiredTextSchema,
  sourceHashSchema,
  translationAuditShape,
  translationOriginSchema,
  validateTranslationAudit,
  revisionLifecycleSchema,
} from "./content-lifecycle.js";
import {
  idolIdSchema,
  giftIdSchema,
  mediaAssetIdSchema,
  adminIdentityIdSchema,
  idempotencyKeySchema,
} from "./identifiers.js";
import { supportedLocaleSchema, DEFAULT_LOCALE } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";
import {
  idolAliasSetSchema,
  createIdolAliasDraftCommandSchema,
  giftDetailDraftResponseSchema,
} from "./content-drafts.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
} from "./gift-details.js";

const originShape = {
  locale: supportedLocaleSchema,
  origin: translationOriginSchema,
  importBatchId: z.uuid().optional(),
} as const;
function validateOrigin(
  value: { origin: string; importBatchId?: string | undefined },
  context: z.RefinementCtx,
) {
  if ((value.origin === "IMPORT") !== (value.importBatchId !== undefined))
    context.addIssue({
      code: "custom",
      message: "import batch is required exactly for imported content",
      path: ["importBatchId"],
    });
}
function uniqueLocales(
  values: readonly { locale: string }[],
  context: z.RefinementCtx,
) {
  if (new Set(values.map((row) => row.locale)).size !== values.length)
    context.addIssue({
      code: "custom",
      message: "translations must have distinct locales",
    });
}
function requireEnglish(
  values: readonly { locale: string }[],
  context: z.RefinementCtx,
) {
  uniqueLocales(values, context);
  if (!values.some((row) => row.locale === DEFAULT_LOCALE))
    context.addIssue({
      code: "custom",
      message: "actual English source is required",
    });
}
const idolText = z
  .strictObject({ ...originShape, fields: idolTranslationFieldsSchema })
  .superRefine(validateOrigin);
const giftText = z
  .strictObject({ ...originShape, fields: giftTranslationFieldsSchema })
  .superRefine(validateOrigin);
const homepageText = z
  .strictObject({ ...originShape, fields: homepageTranslationFieldsSchema })
  .superRefine(validateOrigin);
const policyText = z
  .strictObject({ ...originShape, fields: policyTranslationFieldsSchema })
  .superRefine(validateOrigin);
const mediaText = z
  .strictObject({
    ...originShape,
    fields: z.strictObject({
      alt: z.string().max(300),
      title: createRequiredTextSchema(160).optional(),
      caption: createRequiredTextSchema(300).optional(),
    }),
  })
  .superRefine(validateOrigin);
const aliases = createIdolAliasDraftCommandSchema.shape.aliases;
const detailText = z
  .strictObject({ ...originShape, ...giftDetailTranslationFieldsSchema.shape })
  .superRefine(validateOrigin);
const details = z.strictObject({
  blocks: giftDetailDocumentSchema.shape.blocks,
  translations: z.array(detailText).min(1).max(7).superRefine(requireEnglish),
});
const idolStructure = idolRevisionSchema.pick({
  themeAccent: true,
  heroTextTone: true,
  displayOrder: true,
});
const giftStructure = giftRevisionSchema.pick({
  category: true,
  contents: true,
  deliveryEstimate: true,
  requiresSafetyNotice: true,
  shippingMode: true,
});
// PostgreSQL retains microseconds; reject values it would round or normalize
// outside the four-digit UTC years accepted by the read contract.
const policyEffectiveAt = contentTimestampSchema
  .regex(/^[^.]+(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine((value) => {
    const utcYear = new Date(value).getUTCFullYear();
    return Number(value.slice(0, 4)) >= 1 && utcYear >= 1 && utcYear <= 9999;
  }, "policy effective time must remain within UTC years 0001 through 9999");
const policyStructure = policyRevisionSchema
  .pick({ kind: true, effectiveAt: true })
  .extend({ effectiveAt: policyEffectiveAt });
const focalCoordinate = z.number().min(0).max(1).multipleOf(0.00001);
const mediaStructure = mediaMetadataRevisionSchema
  .pick({
    presentationKind: true,
    focalPoint: true,
  })
  .extend({
    focalPoint: z.strictObject({ x: focalCoordinate, y: focalCoordinate }),
  });
const slots = z
  .array(
    z.union([
      homepageSlotSchema.options[0].omit({
        schemaVersion: true,
        homepageRevisionId: true,
      }),
      homepageSlotSchema.options[1].omit({
        schemaVersion: true,
        homepageRevisionId: true,
      }),
      homepageSlotSchema.options[2].omit({
        schemaVersion: true,
        homepageRevisionId: true,
      }),
      homepageSlotSchema.options[3].omit({
        schemaVersion: true,
        homepageRevisionId: true,
      }),
    ]),
  )
  .min(1)
  .max(32);
const homepageStructure = z.strictObject({
  slots: slots.superRefine((values, context) => {
    for (const [index, slot] of values.entries()) {
      if (slot.kind !== "HERO_IDOL") continue;
      if (
        slot.desktopMediaAssetId.toLowerCase() ===
        slot.mobileMediaAssetId.toLowerCase()
      )
        context.addIssue({
          code: "custom",
          message: "desktop and mobile hero assets must differ",
          path: [index, "mobileMediaAssetId"],
        });
      if (
        slot.desktopMediaMetadataRevisionId.toLowerCase() ===
        slot.mobileMediaMetadataRevisionId.toLowerCase()
      )
        context.addIssue({
          code: "custom",
          message: "desktop and mobile hero metadata must differ",
          path: [index, "mobileMediaMetadataRevisionId"],
        });
    }
  }),
});
const idolMedia = z
  .array(
    idolRevisionMediaSchema.omit({ schemaVersion: true, idolRevisionId: true }),
  )
  .max(15);
const giftMedia = z
  .array(
    giftRevisionMediaSchema.omit({ schemaVersion: true, giftRevisionId: true }),
  )
  .max(13);

export const contentAuthoringTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("IDOL"), idolId: idolIdSchema }),
  z.strictObject({ kind: z.literal("GIFT"), giftId: giftIdSchema }),
  z.strictObject({ kind: z.literal("HOMEPAGE") }),
  z.strictObject({ kind: z.literal("POLICY"), policyKey: policyKeySchema }),
  z.strictObject({
    kind: z.literal("MEDIA_METADATA"),
    mediaAssetId: mediaAssetIdSchema,
  }),
]);
export const contentAuthoringContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("IDOL"),
    structure: idolStructure,
    media: idolMedia,
    translations: z.array(idolText).min(1).max(7).superRefine(requireEnglish),
    aliases: aliases.optional(),
  }),
  z.strictObject({
    kind: z.literal("GIFT"),
    structure: giftStructure,
    media: giftMedia,
    translations: z.array(giftText).min(1).max(7).superRefine(requireEnglish),
    details: details.optional(),
  }),
  z.strictObject({
    kind: z.literal("HOMEPAGE"),
    structure: homepageStructure,
    translations: z
      .array(homepageText)
      .min(1)
      .max(7)
      .superRefine(requireEnglish),
  }),
  z.strictObject({
    kind: z.literal("POLICY"),
    structure: policyStructure,
    translations: z.array(policyText).min(1).max(7).superRefine(requireEnglish),
  }),
  z.strictObject({
    kind: z.literal("MEDIA_METADATA"),
    structure: mediaStructure,
    translations: z.array(mediaText).min(1).max(7).superRefine(requireEnglish),
  }),
]);
export const contentAuthoringChangesSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("IDOL"),
    structure: idolStructure.optional(),
    media: idolMedia.optional(),
    translations: z
      .array(idolText)
      .min(1)
      .max(7)
      .superRefine(uniqueLocales)
      .optional(),
    aliases: aliases.optional(),
  }),
  z.strictObject({
    kind: z.literal("GIFT"),
    structure: giftStructure.optional(),
    media: giftMedia.optional(),
    translations: z
      .array(giftText)
      .min(1)
      .max(7)
      .superRefine(uniqueLocales)
      .optional(),
    details: details.optional(),
  }),
  z.strictObject({
    kind: z.literal("HOMEPAGE"),
    structure: homepageStructure.optional(),
    translations: z
      .array(homepageText)
      .min(1)
      .max(7)
      .superRefine(uniqueLocales)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("POLICY"),
    structure: policyStructure.optional(),
    translations: z
      .array(policyText)
      .min(1)
      .max(7)
      .superRefine(uniqueLocales)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("MEDIA_METADATA"),
    structure: mediaStructure.optional(),
    translations: z
      .array(mediaText)
      .min(1)
      .max(7)
      .superRefine(uniqueLocales)
      .optional(),
  }),
]);
const mutationShape = {
  schemaVersion: schemaVersionSchema,
  target: contentAuthoringTargetSchema,
  expectedVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  idempotencyKey: idempotencyKeySchema,
} as const;
export const contentAuthoringCommandSchema = z
  .discriminatedUnion("action", [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      action: z.literal("READ"),
      target: contentAuthoringTargetSchema,
      revisionId: z.uuid(),
    }),
    z.strictObject({
      ...mutationShape,
      action: z.literal("CREATE"),
      content: contentAuthoringContentSchema,
    }),
    z.strictObject({
      ...mutationShape,
      action: z.literal("COPY"),
      sourceRevisionId: z.uuid(),
      expectedSourceHash: sourceHashSchema,
      changes: contentAuthoringChangesSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (
      (value.action === "CREATE" && value.content.kind !== value.target.kind) ||
      (value.action === "COPY" && value.changes.kind !== value.target.kind)
    )
      context.addIssue({
        code: "custom",
        message: "content kind must match the target",
      });
  });
const audit = z
  .strictObject({
    id: z.uuid(),
    reviewId: z.uuid(),
    reviewSequence: z.number().int().positive(),
    ...translationAuditShape,
    inheritedFrom: z
      .strictObject({
        revisionId: z.uuid(),
        translationId: z.uuid(),
        reviewId: z.uuid(),
      })
      .optional(),
  })
  .superRefine(validateTranslationAudit);
export const contentAuthoringSnapshotSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    target: contentAuthoringTargetSchema,
    revisionId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    headVersion: z.number().int().positive(),
    lifecycle: revisionLifecycleSchema,
    createdBy: adminIdentityIdSchema,
    createdAt: contentTimestampSchema,
    contentHash: sourceHashSchema,
    content: contentAuthoringContentSchema,
    translationAudits: z.array(audit).min(1).max(7).superRefine(requireEnglish),
    extensions: z.strictObject({
      aliases: idolAliasSetSchema.optional(),
      details: giftDetailDraftResponseSchema.options[0].optional(),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.target.kind !== value.content.kind ||
      value.revisionNumber > value.headVersion
    )
      context.addIssue({
        code: "custom",
        message: "snapshot owner and head must match",
      });
    const locales = value.content.translations
      .map((row) => row.locale)
      .sort()
      .join();
    if (
      locales !==
      value.translationAudits
        .map((row) => row.locale)
        .sort()
        .join()
    )
      context.addIssue({
        code: "custom",
        message: "snapshot text and audit locales must match",
      });
    if (
      value.extensions.aliases &&
      (value.target.kind !== "IDOL" ||
        value.extensions.aliases.idolRevisionId.toLowerCase() !==
          value.revisionId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        message: "aliases must belong to snapshot",
      });
    if (
      value.extensions.details &&
      (value.target.kind !== "GIFT" ||
        value.extensions.details.document.giftRevisionId.toLowerCase() !==
          value.revisionId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        message: "details must belong to snapshot",
      });
  });
export const contentAuthoringReadCommandSchema =
  contentAuthoringCommandSchema.options[0];
export const contentAuthoringWriteCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    command: z.union([
      contentAuthoringCommandSchema.options[1],
      contentAuthoringCommandSchema.options[2],
    ]),
    actorId: adminIdentityIdSchema,
    requestId: z.uuid(),
  })
  .superRefine((value, context) => {
    if (!contentAuthoringCommandSchema.safeParse(value.command).success)
      context.addIssue({
        code: "custom",
        message: "invalid authoring command",
      });
  });
export const contentAuthoringReadResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("REVISION"),
    snapshot: contentAuthoringSnapshotSchema,
  }),
  adminContentFailureSchema,
]);
export const contentAuthoringResponseSchema = z.union([
  contentAuthoringReadResponseSchema,
  adminMutationResponseSchema,
]);
export const contentAuthoringRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: contentAuthoringCommandSchema });
export type ContentAuthoringTarget = z.infer<
  typeof contentAuthoringTargetSchema
>;
export type ContentAuthoringContent = z.infer<
  typeof contentAuthoringContentSchema
>;
export type ContentAuthoringChanges = z.infer<
  typeof contentAuthoringChangesSchema
>;
export type ContentAuthoringCommand = z.infer<
  typeof contentAuthoringCommandSchema
>;
export type ContentAuthoringSnapshot = z.infer<
  typeof contentAuthoringSnapshotSchema
>;
export type ContentAuthoringReadCommand = z.infer<
  typeof contentAuthoringReadCommandSchema
>;
export type ContentAuthoringWriteCommand = z.infer<
  typeof contentAuthoringWriteCommandSchema
>;
export type ContentAuthoringReadResponse = z.infer<
  typeof contentAuthoringReadResponseSchema
>;
export type ContentAuthoringResponse = z.infer<
  typeof contentAuthoringResponseSchema
>;
export type ContentAuthoringRequest = z.infer<
  typeof contentAuthoringRequestSchema
>;

export const contentAuthoringPlanSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  content: contentAuthoringContentSchema,
  translationAudits: z
    .array(
      z
        .strictObject({
          ...translationAuditShape,
          inheritedFrom: audit.shape.inheritedFrom,
        })
        .superRefine(validateTranslationAudit),
    )
    .min(1)
    .max(7)
    .superRefine(requireEnglish),
});
export type ContentAuthoringPlan = z.infer<typeof contentAuthoringPlanSchema>;
