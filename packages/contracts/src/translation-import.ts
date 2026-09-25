import { z } from "zod";

import {
  giftTranslationFieldsSchema,
  idolTranslationFieldsSchema,
} from "./catalog-content.js";
import { sourceHashSchema } from "./content-lifecycle.js";
import {
  homepageTranslationFieldsSchema,
  policyTranslationFieldsSchema,
} from "./content-models.js";
import {
  giftRevisionIdSchema,
  homepageRevisionIdSchema,
  idolRevisionIdSchema,
  mediaMetadataRevisionIdSchema,
  policyRevisionIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { mediaMetadataRevisionTranslationSchema } from "./media-content.js";
import { schemaVersionSchema } from "./versioning.js";

export const mediaTranslationFieldsSchema = z.strictObject({
  alt: mediaMetadataRevisionTranslationSchema.shape.alt,
  title: mediaMetadataRevisionTranslationSchema.shape.title,
  caption: mediaMetadataRevisionTranslationSchema.shape.caption,
});

const translationImportContext = <Fields extends z.ZodType>(fields: Fields) =>
  z.strictObject({
    englishSource: fields,
  });

const translationDraftCreationShape = {
  schemaVersion: schemaVersionSchema,
  locale: supportedLocaleSchema,
  expectedEnglishSourceHash: sourceHashSchema,
  contentHash: sourceHashSchema,
  origin: z.enum(["MACHINE", "IMPORT"]),
  importBatchId: z.uuid().optional(),
  review: z.strictObject({
    status: z.literal("DRAFT"),
  }),
} as const;

const idolTranslationImportPackageSchema = z.strictObject({
  ...translationDraftCreationShape,
  objectKind: z.literal("IDOL"),
  parentRevisionId: idolRevisionIdSchema,
  context: translationImportContext(idolTranslationFieldsSchema),
  fields: idolTranslationFieldsSchema,
});

const giftTranslationImportPackageSchema = z.strictObject({
  ...translationDraftCreationShape,
  objectKind: z.literal("GIFT"),
  parentRevisionId: giftRevisionIdSchema,
  context: translationImportContext(giftTranslationFieldsSchema),
  fields: giftTranslationFieldsSchema,
});

const homepageTranslationImportPackageSchema = z.strictObject({
  ...translationDraftCreationShape,
  objectKind: z.literal("HOMEPAGE"),
  parentRevisionId: homepageRevisionIdSchema,
  context: translationImportContext(homepageTranslationFieldsSchema),
  fields: homepageTranslationFieldsSchema,
});

const policyTranslationImportPackageSchema = z.strictObject({
  ...translationDraftCreationShape,
  objectKind: z.literal("POLICY"),
  parentRevisionId: policyRevisionIdSchema,
  context: translationImportContext(policyTranslationFieldsSchema),
  fields: policyTranslationFieldsSchema,
});

const mediaTranslationImportPackageSchema = z.strictObject({
  ...translationDraftCreationShape,
  objectKind: z.literal("MEDIA_METADATA"),
  parentRevisionId: mediaMetadataRevisionIdSchema,
  context: translationImportContext(mediaTranslationFieldsSchema),
  fields: mediaTranslationFieldsSchema,
});

export const translationImportPackageSchema = z
  .discriminatedUnion("objectKind", [
    idolTranslationImportPackageSchema,
    giftTranslationImportPackageSchema,
    homepageTranslationImportPackageSchema,
    policyTranslationImportPackageSchema,
    mediaTranslationImportPackageSchema,
  ])
  .superRefine((value, context) => {
    if (value.origin === "IMPORT" && value.importBatchId === undefined) {
      context.addIssue({
        code: "custom",
        message: "import draft creation requires an import batch id",
        path: ["importBatchId"],
      });
    }
    if (value.origin !== "IMPORT" && value.importBatchId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "only import draft creation may carry an import batch id",
        path: ["importBatchId"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "machine and import creation commands only create DRAFT translations",
      "IMPORT creation commands require importBatchId",
      "context and fields use object-specific translation schemas rather than generic JSON",
    ],
  });

export const translationImportValidationIssueCodeSchema = z.enum([
  "SCHEMA_INVALID",
  "TARGET_MISMATCH",
  "STALE_ENGLISH_SOURCE",
  "ENGLISH_CONTEXT_HASH_MISMATCH",
  "CONTENT_HASH_MISMATCH",
  "ICU_SYNTAX_INVALID",
  "ICU_VARIABLE_MISMATCH",
]);

export const translationImportValidationIssueSchema = z.strictObject({
  code: translationImportValidationIssueCodeSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
});

export const translationImportValidationReportSchema = z.discriminatedUnion(
  "valid",
  [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      valid: z.literal(true),
      contentHash: sourceHashSchema,
      issues: z.tuple([]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      valid: z.literal(false),
      issues: z.array(translationImportValidationIssueSchema).min(1),
    }),
  ],
);

export type MediaTranslationFields = z.infer<
  typeof mediaTranslationFieldsSchema
>;
export type TranslationImportPackage = z.infer<
  typeof translationImportPackageSchema
>;
type TranslationImportTrustedTargetFor<
  Package extends TranslationImportPackage,
> = Package extends {
  objectKind: infer ObjectKind;
  parentRevisionId: infer ParentRevisionId;
}
  ? {
      readonly objectKind: ObjectKind;
      readonly parentRevisionId: ParentRevisionId;
      readonly currentEnglishSourceHash: z.infer<typeof sourceHashSchema>;
    }
  : never;
export type TranslationImportTrustedTarget =
  TranslationImportTrustedTargetFor<TranslationImportPackage>;
export type TranslationImportValidationIssueCode = z.infer<
  typeof translationImportValidationIssueCodeSchema
>;
export type TranslationImportValidationIssue = z.infer<
  typeof translationImportValidationIssueSchema
>;
export type TranslationImportValidationReport = z.infer<
  typeof translationImportValidationReportSchema
>;
