import { decodeHTML } from "entities";
import { z } from "zod";

import {
  createRequiredTextSchema,
  sourceHashSchema,
  translationAuditShape,
  validateTranslationAudit,
} from "./content-lifecycle.js";
import {
  giftRevisionIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { schemaVersionSchema } from "./versioning.js";

export const giftDetailDocumentIdSchema = z
  .uuid()
  .brand<"GiftDetailDocumentId">();
const stableKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

function plainText(maximum: number) {
  return createRequiredTextSchema(maximum).refine(
    (value) => !/[<>]/u.test(decodeHTML(value)),
    "gift details contain plain text, not HTML or encoded markup",
  );
}

function uniqueKeys(values: readonly string[], context: z.RefinementCtx) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: "detail identities must be unique",
        path: [index],
      });
    }
    seen.add(value);
  });
}

const itemIdsSchema = z
  .array(stableKeySchema)
  .min(1)
  .max(24)
  .superRefine(uniqueKeys);

export const giftDetailBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: stableKeySchema,
    kind: z.literal("HEADING"),
    level: z.union([z.literal(2), z.literal(3)]),
  }),
  z.strictObject({ id: stableKeySchema, kind: z.literal("PARAGRAPH") }),
  z.strictObject({
    id: stableKeySchema,
    kind: z.literal("LIST"),
    style: z.enum(["ORDERED", "UNORDERED"]),
    itemIds: itemIdsSchema,
  }),
  z.strictObject({
    id: stableKeySchema,
    kind: z.literal("SPECIFICATIONS"),
    itemIds: itemIdsSchema,
  }),
  z.strictObject({
    id: stableKeySchema,
    kind: z.literal("MEDIA"),
    mediaAssetId: mediaAssetIdSchema,
    mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
    captionEnabled: z.boolean(),
  }),
]);

export const giftDetailDocumentSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: giftDetailDocumentIdSchema,
    giftRevisionId: giftRevisionIdSchema,
    blocks: z
      .array(giftDetailBlockSchema)
      .min(1)
      .max(32)
      .superRefine((blocks, context) =>
        uniqueKeys(
          blocks.map((block) => block.id),
          context,
        ),
      ),
  })
  .meta({
    "x-runtime-invariants": [
      "block ids are unique within a document",
      "item ids are unique within their block",
      "media must be resolved through the approved asset and metadata revision",
    ],
  });

const listItemsSchema = z
  .array(z.strictObject({ itemId: stableKeySchema, text: plainText(600) }))
  .min(1)
  .max(24)
  .superRefine((items, context) =>
    uniqueKeys(
      items.map((item) => item.itemId),
      context,
    ),
  );
const specificationItemsSchema = z
  .array(
    z.strictObject({
      itemId: stableKeySchema,
      label: plainText(160),
      value: plainText(600),
    }),
  )
  .min(1)
  .max(24)
  .superRefine((items, context) =>
    uniqueKeys(
      items.map((item) => item.itemId),
      context,
    ),
  );

const translatedBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    blockId: stableKeySchema,
    kind: z.literal("HEADING"),
    text: plainText(160),
  }),
  z.strictObject({
    blockId: stableKeySchema,
    kind: z.literal("PARAGRAPH"),
    text: plainText(4_000),
  }),
  z.strictObject({
    blockId: stableKeySchema,
    kind: z.literal("LIST"),
    items: listItemsSchema,
  }),
  z.strictObject({
    blockId: stableKeySchema,
    kind: z.literal("SPECIFICATIONS"),
    items: specificationItemsSchema,
  }),
  z.strictObject({
    blockId: stableKeySchema,
    kind: z.literal("MEDIA"),
    // Binds caption copy to the metadata revision; the document owns the asset.
    mediaMetadataRevisionId: mediaMetadataRevisionIdSchema,
    caption: plainText(300).optional(),
  }),
]);

export const giftDetailTranslationFieldsSchema = z.strictObject({
  blocks: z
    .array(translatedBlockSchema)
    .min(1)
    .max(32)
    .superRefine((blocks, context) =>
      uniqueKeys(
        blocks.map((block) => block.blockId),
        context,
      ),
    ),
});

export const giftDetailTranslationSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: translationRevisionIdSchema,
    documentId: giftDetailDocumentIdSchema,
    giftRevisionId: giftRevisionIdSchema,
    ...translationAuditShape,
    ...giftDetailTranslationFieldsSchema.shape,
  })
  .superRefine(validateTranslationAudit)
  .meta({
    "x-runtime-invariants": [
      "English sourceHash equals translatedFromSourceHash",
      "editor and reviewer differ for APPROVED evidence",
      "the server recomputes content and current English source hashes",
      "parsing is not authorization to approve or publish a translation",
    ],
  });

export const giftDetailValidationIssueCodeSchema = z.enum([
  "SCHEMA_INVALID",
  "DOCUMENT_TARGET_MISMATCH",
  "GIFT_REVISION_TARGET_MISMATCH",
  "BLOCK_MISSING",
  "BLOCK_UNKNOWN",
  "BLOCK_KIND_MISMATCH",
  "ITEM_MISSING",
  "ITEM_UNKNOWN",
  "MEDIA_REFERENCE_MISMATCH",
  "CAPTION_REQUIRED",
  "CAPTION_UNEXPECTED",
  "CONTENT_HASH_MISMATCH",
  "STALE_ENGLISH_SOURCE",
]);

export const giftDetailValidationIssueSchema = z.strictObject({
  code: giftDetailValidationIssueCodeSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
});

export const giftDetailValidationInputSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    document: giftDetailDocumentSchema,
    translation: giftDetailTranslationSchema,
    currentEnglishSourceHash: sourceHashSchema,
  })
  .meta({
    "x-runtime-invariants": [
      "currentEnglishSourceHash comes from the trusted current English detail document and fields, never from an untrusted client assertion",
    ],
  });

export const giftDetailValidationReportSchema = z
  .discriminatedUnion("valid", [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      valid: z.literal(true),
      contentHash: sourceHashSchema,
      issues: z.tuple([]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      valid: z.literal(false),
      issues: z.array(giftDetailValidationIssueSchema).min(1),
    }),
  ])
  .meta({
    "x-runtime-invariants": [
      "valid means structural and hash consistency only, not permission or readiness to publish",
    ],
  });

export type GiftDetailDocumentId = z.infer<typeof giftDetailDocumentIdSchema>;
export type GiftDetailBlock = z.infer<typeof giftDetailBlockSchema>;
export type GiftDetailDocument = z.infer<typeof giftDetailDocumentSchema>;
export type GiftDetailTranslationFields = z.infer<
  typeof giftDetailTranslationFieldsSchema
>;
export type GiftDetailTranslation = z.infer<typeof giftDetailTranslationSchema>;
export type GiftDetailValidationIssue = z.infer<
  typeof giftDetailValidationIssueSchema
>;
export type GiftDetailValidationReport = z.infer<
  typeof giftDetailValidationReportSchema
>;
export type GiftDetailValidationInput = z.infer<
  typeof giftDetailValidationInputSchema
>;
