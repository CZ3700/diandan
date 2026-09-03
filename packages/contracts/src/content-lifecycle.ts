import { z } from "zod";

import { decodeHTML } from "entities";

import { adminIdentityIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";

export const contentTimestampSchema = z.iso.datetime({ offset: true });
export const positiveRevisionSchema = z.number().int().positive();

export const catalogRevisionLifecycleStatusSchema = z.enum([
  "DRAFT",
  "VALIDATED",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
]);

export const revisionLifecycleSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("DRAFT"),
    }),
    z.strictObject({
      status: z.literal("VALIDATED"),
      validatedAt: contentTimestampSchema,
    }),
    z.strictObject({
      status: z.literal("PUBLISHED"),
      validatedAt: contentTimestampSchema,
      publishedAt: contentTimestampSchema,
    }),
    z.strictObject({
      status: z.literal("SUPERSEDED"),
      validatedAt: contentTimestampSchema,
      publishedAt: contentTimestampSchema,
      supersededAt: contentTimestampSchema,
    }),
    z.strictObject({
      status: z.literal("ARCHIVED"),
      validatedAt: contentTimestampSchema,
      publishedAt: contentTimestampSchema,
      supersededAt: contentTimestampSchema,
      archivedAt: contentTimestampSchema,
    }),
  ])
  .superRefine((value, context) => {
    const orderedTimes = [
      "validatedAt" in value ? value.validatedAt : undefined,
      "publishedAt" in value ? value.publishedAt : undefined,
      "supersededAt" in value ? value.supersededAt : undefined,
      "archivedAt" in value ? value.archivedAt : undefined,
    ].filter((timestamp): timestamp is string => timestamp !== undefined);

    for (let index = 1; index < orderedTimes.length; index += 1) {
      const previous = orderedTimes[index - 1];
      const current = orderedTimes[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        Date.parse(current) < Date.parse(previous)
      ) {
        context.addIssue({
          code: "custom",
          message: "revision lifecycle timestamps must be chronological",
          path: [],
        });
        return;
      }
    }
  })
  .meta({
    "x-runtime-invariants": [
      "revision lifecycle timestamps are chronological",
      "rollback changes the current publication pointer and does not mutate revision status",
    ],
  });

export const sourceHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<"SourceHash">();

export const CONTROLLED_RICH_TEXT_ALLOWED_TAGS = Object.freeze([
  "p",
  "br",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
] as const);

export function hasVisibleText(value: string): boolean {
  return (
    decodeHTML(value.replace(/<[^>]*>/gu, "")).replace(
      /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\u2800]/gu,
      "",
    ).length > 0
  );
}

export function createRequiredTextSchema(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      hasVisibleText,
      "text must contain a visible non-whitespace character",
    );
}

function isControlledRichText(value: string): boolean {
  const openTags: string[] = [];
  let cursor = 0;

  for (const match of value.matchAll(/<[^>]*>/gu)) {
    const index = match.index;
    const token = match[0];
    if (index === undefined || value.slice(cursor, index).includes("<")) {
      return false;
    }

    if (/^<br(?: ?\/)?>$/u.test(token)) {
      cursor = index + token.length;
      continue;
    }

    const opening = /^<(p|strong|em|ul|ol|li)>$/u.exec(token);
    if (opening?.[1] !== undefined) {
      openTags.push(opening[1]);
      cursor = index + token.length;
      continue;
    }

    const closing = /^<\/(p|strong|em|ul|ol|li)>$/u.exec(token);
    if (closing?.[1] === undefined || openTags.pop() !== closing[1]) {
      return false;
    }
    cursor = index + token.length;
  }

  return openTags.length === 0 && !value.slice(cursor).includes("<");
}

export function createControlledRichTextSchema(maxLength: number) {
  return createRequiredTextSchema(maxLength)
    .refine(isControlledRichText, {
      message:
        "rich text must use balanced lowercase p, br, strong, em, ul, ol, and li tags without attributes",
    })
    .meta({
      "x-allowed-html-tags": CONTROLLED_RICH_TEXT_ALLOWED_TAGS,
      "x-html-attributes": "forbidden",
    });
}

export const translationOriginSchema = z.enum(["HUMAN", "MACHINE", "IMPORT"]);

export const translationReviewStatusSchema = z.enum([
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
]);

export const translationReviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("DRAFT"),
  }),
  z.strictObject({
    status: z.literal("IN_REVIEW"),
    submittedAt: contentTimestampSchema,
  }),
  z.strictObject({
    status: z.literal("APPROVED"),
    reviewerId: adminIdentityIdSchema,
    reviewedAt: contentTimestampSchema,
    reviewedSourceHash: sourceHashSchema,
    reviewedContentHash: sourceHashSchema,
  }),
]);

export const translationAuditShape = {
  locale: supportedLocaleSchema,
  sourceHash: sourceHashSchema,
  translatedFromSourceHash: sourceHashSchema,
  origin: translationOriginSchema,
  importBatchId: z.uuid().optional(),
  editorId: adminIdentityIdSchema,
  editedAt: contentTimestampSchema,
  review: translationReviewSchema,
} as const;

type TranslationAudit = Readonly<{
  locale: string;
  sourceHash: string;
  translatedFromSourceHash: string;
  origin: "HUMAN" | "MACHINE" | "IMPORT";
  importBatchId?: string | undefined;
  editorId: string;
  editedAt: string;
  review:
    | Readonly<{ status: "DRAFT" }>
    | Readonly<{ status: "IN_REVIEW"; submittedAt: string }>
    | Readonly<{
        status: "APPROVED";
        reviewerId: string;
        reviewedAt: string;
        reviewedSourceHash: string;
        reviewedContentHash: string;
      }>;
}>;

export function validateTranslationAudit(
  value: TranslationAudit,
  context: z.RefinementCtx,
): void {
  if (value.origin === "IMPORT" && value.importBatchId === undefined) {
    context.addIssue({
      code: "custom",
      message: "imported translations must retain their import batch id",
      path: ["importBatchId"],
    });
  }
  if (value.origin !== "IMPORT" && value.importBatchId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "only imported translations may carry an import batch id",
      path: ["importBatchId"],
    });
  }

  if (
    value.locale === "en" &&
    value.sourceHash !== value.translatedFromSourceHash
  ) {
    context.addIssue({
      code: "custom",
      message: "English source and translated-from hashes must match",
      path: ["translatedFromSourceHash"],
    });
  }

  if (value.review.status === "IN_REVIEW") {
    if (Date.parse(value.review.submittedAt) < Date.parse(value.editedAt)) {
      context.addIssue({
        code: "custom",
        message: "translation cannot be submitted before its latest edit",
        path: ["review", "submittedAt"],
      });
    }
    return;
  }

  if (value.review.status !== "APPROVED") {
    return;
  }

  if (value.editorId.toLowerCase() === value.review.reviewerId.toLowerCase()) {
    context.addIssue({
      code: "custom",
      message: "translation editor and reviewer must differ",
      path: ["review", "reviewerId"],
    });
  }
  if (Date.parse(value.review.reviewedAt) < Date.parse(value.editedAt)) {
    context.addIssue({
      code: "custom",
      message: "translation cannot be reviewed before its latest edit",
      path: ["review", "reviewedAt"],
    });
  }
  if (value.review.reviewedSourceHash !== value.translatedFromSourceHash) {
    context.addIssue({
      code: "custom",
      message: "approval must bind the current English source hash",
      path: ["review", "reviewedSourceHash"],
    });
  }
  if (value.review.reviewedContentHash !== value.sourceHash) {
    context.addIssue({
      code: "custom",
      message: "approval must bind the current localized content hash",
      path: ["review", "reviewedContentHash"],
    });
  }
}

export type CatalogRevisionLifecycleStatus = z.infer<
  typeof catalogRevisionLifecycleStatusSchema
>;
export type RevisionLifecycle = z.infer<typeof revisionLifecycleSchema>;
export type SourceHash = z.infer<typeof sourceHashSchema>;
export type TranslationOrigin = z.infer<typeof translationOriginSchema>;
export type TranslationReview = z.infer<typeof translationReviewSchema>;
