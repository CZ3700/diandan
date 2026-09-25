import { decodeHTML } from "entities";
import { z } from "zod";

import {
  contentTimestampSchema,
  createRequiredTextSchema,
  sourceHashSchema,
  translationOriginSchema,
} from "./content-lifecycle.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
  giftDetailTranslationSchema,
} from "./gift-details.js";
import {
  adminIdentityIdSchema,
  giftRevisionIdSchema,
  idolRevisionIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

export const idolAliasSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  locale: supportedLocaleSchema.nullable(),
  text: createRequiredTextSchema(80).refine(
    (value) => !/[<>\p{Cc}]/u.test(decodeHTML(value)),
    "aliases contain plain text without markup or control characters",
  ),
});

const aliasesSchema = z
  .array(idolAliasSchema)
  .max(64)
  .superRefine((aliases, context) => {
    const ids = new Set<string>();
    const localizedText = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
      const textKey = JSON.stringify([
        alias.locale,
        alias.text.normalize("NFC"),
      ]);
      if (ids.has(alias.id)) {
        context.addIssue({
          code: "custom",
          message: "alias ids must be unique within the set",
          path: [index, "id"],
        });
      }
      if (localizedText.has(textKey)) {
        context.addIssue({
          code: "custom",
          message:
            "same-locale alias copy must be unique after NFC normalization",
          path: [index, "text"],
        });
      }
      ids.add(alias.id);
      localizedText.add(textKey);
    }
  });

export const idolAliasReviewSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("DRAFT") }),
  z.strictObject({
    status: z.literal("IN_REVIEW"),
    submittedAt: contentTimestampSchema,
  }),
  z.strictObject({
    status: z.literal("APPROVED"),
    reviewerId: adminIdentityIdSchema,
    reviewedAt: contentTimestampSchema,
    reviewedContentHash: sourceHashSchema,
  }),
]);

export const idolAliasSetSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: z.uuid(),
    idolRevisionId: idolRevisionIdSchema,
    aliases: aliasesSchema,
    contentHash: sourceHashSchema,
    editorId: adminIdentityIdSchema,
    editedAt: contentTimestampSchema,
    review: idolAliasReviewSchema,
  })
  .superRefine((value, context) => {
    const { review } = value;
    if (
      review.status === "IN_REVIEW" &&
      Date.parse(review.submittedAt) < Date.parse(value.editedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "alias review submission cannot precede its latest edit",
        path: ["review", "submittedAt"],
      });
    }
    if (review.status !== "APPROVED") return;
    if (review.reviewerId.toLowerCase() === value.editorId.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "alias editor and reviewer must differ",
        path: ["review", "reviewerId"],
      });
    }
    if (Date.parse(review.reviewedAt) < Date.parse(value.editedAt)) {
      context.addIssue({
        code: "custom",
        message: "alias approval cannot precede its latest edit",
        path: ["review", "reviewedAt"],
      });
    }
    if (review.reviewedContentHash !== value.contentHash) {
      context.addIssue({
        code: "custom",
        message: "alias approval must bind the complete set hash",
        path: ["review", "reviewedContentHash"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "the complete alias set is an independent approval unit and is bound to its idol revision",
      "aliases are optional language-specific transcriptions or universal proper names, not seven translated source documents",
      "the server recomputes the set hash; parsing does not authorize approval or public search",
    ],
  });

const draftAuthorityShape = {
  actorId: adminIdentityIdSchema,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  requestId: z.uuid(),
} as const;

export const createIdolAliasDraftCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: z.uuid(),
  idolRevisionId: idolRevisionIdSchema,
  aliases: aliasesSchema,
  ...draftAuthorityShape,
});

const draftTranslationSchema = z
  .strictObject({
    id: translationRevisionIdSchema,
    locale: supportedLocaleSchema,
    origin: translationOriginSchema,
    importBatchId: z.uuid().optional(),
    ...giftDetailTranslationFieldsSchema.shape,
  })
  .superRefine((value, context) => {
    if ((value.origin === "IMPORT") !== (value.importBatchId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "import batch identity is required exactly for imported copy",
        path: ["importBatchId"],
      });
    }
  });

function validateTranslationSet(
  values: readonly { id: string; locale: string }[],
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  const locales = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (ids.has(value.id.toLowerCase())) {
      context.addIssue({
        code: "custom",
        message: "translation revision ids must be unique",
        path: [index, "id"],
      });
    }
    if (locales.has(value.locale)) {
      context.addIssue({
        code: "custom",
        message: "each locale has exactly one translation",
        path: [index, "locale"],
      });
    }
    ids.add(value.id.toLowerCase());
    locales.add(value.locale);
  }
  if (!locales.has("en")) {
    context.addIssue({
      code: "custom",
      message: "detail drafts require actual English source copy",
      path: [],
    });
  }
}

export const createGiftDetailDraftCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  document: giftDetailDocumentSchema,
  translations: z
    .array(draftTranslationSchema)
    .min(1)
    .max(7)
    .superRefine(validateTranslationSet),
  ...draftAuthorityShape,
});

export const contentDraftReadCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("IDOL_ALIASES"),
    idolRevisionId: idolRevisionIdSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("GIFT_DETAILS"),
    giftRevisionId: giftRevisionIdSchema,
  }),
]);

export const contentDraftFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "NOT_FOUND",
    "REVISION_NOT_DRAFT",
    "ALREADY_EXISTS",
    "ACTOR_UNAVAILABLE",
    "INVALID_CONTENT",
    "CONTENT_UNAVAILABLE",
  ]),
});

const idolAliasDraftSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("SUCCESS"),
  aliasSet: idolAliasSetSchema,
});

const giftDetailDraftSuccessSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    document: giftDetailDocumentSchema,
    translations: z
      .array(giftDetailTranslationSchema)
      .min(1)
      .max(7)
      .superRefine(validateTranslationSet),
  })
  .superRefine((value, context) => {
    const english = value.translations.find((row) => row.locale === "en");
    for (const [index, row] of value.translations.entries()) {
      if (
        row.documentId.toLowerCase() !== value.document.id.toLowerCase() ||
        row.giftRevisionId.toLowerCase() !==
          value.document.giftRevisionId.toLowerCase()
      ) {
        context.addIssue({
          code: "custom",
          message:
            "detail translations must belong to the response document and revision",
          path: ["translations", index],
        });
      }
      if (
        english !== undefined &&
        row.translatedFromSourceHash !== english.sourceHash
      ) {
        context.addIssue({
          code: "custom",
          message:
            "detail translations must bind the document's actual English source",
          path: ["translations", index, "translatedFromSourceHash"],
        });
      }
    }
  });

export const idolAliasDraftResponseSchema = z.discriminatedUnion("outcome", [
  idolAliasDraftSuccessSchema,
  contentDraftFailureSchema,
]);
export const giftDetailDraftResponseSchema = z.discriminatedUnion("outcome", [
  giftDetailDraftSuccessSchema,
  contentDraftFailureSchema,
]);
export const contentDraftResponseSchema = z.union([
  idolAliasDraftSuccessSchema,
  giftDetailDraftSuccessSchema,
  contentDraftFailureSchema,
]);

export type IdolAlias = z.infer<typeof idolAliasSchema>;
export type IdolAliasReview = z.infer<typeof idolAliasReviewSchema>;
export type IdolAliasSet = z.infer<typeof idolAliasSetSchema>;
export type CreateIdolAliasDraftCommand = z.infer<
  typeof createIdolAliasDraftCommandSchema
>;
export type CreateGiftDetailDraftCommand = z.infer<
  typeof createGiftDetailDraftCommandSchema
>;
export type ContentDraftReadCommand = z.infer<
  typeof contentDraftReadCommandSchema
>;
export type ContentDraftFailure = z.infer<typeof contentDraftFailureSchema>;
export type IdolAliasDraftResponse = z.infer<
  typeof idolAliasDraftResponseSchema
>;
export type GiftDetailDraftResponse = z.infer<
  typeof giftDetailDraftResponseSchema
>;
export type ContentDraftResponse = z.infer<typeof contentDraftResponseSchema>;
