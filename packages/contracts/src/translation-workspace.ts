import { z } from "zod";
import {
  adminContentFailureSchema,
  adminContentRequestSchema,
} from "./admin-content.js";
import {
  baseContentTargetSchema,
  baseContentTextSchema,
  baseContentReviewResponseSchema,
} from "./base-content.js";
import { contentAuthoringSnapshotSchema } from "./content-authoring.js";
import {
  revisionLifecycleSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { SUPPORTED_LOCALES, supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

export const translationWorkspaceCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  action: z.literal("READ"),
  target: baseContentTargetSchema,
});
export const translationWorkspaceRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: translationWorkspaceCommandSchema });
export const translationPreviousEnglishSchema = z.strictObject({
  revisionId: z.uuid(),
  sourceHash: sourceHashSchema,
  text: baseContentTextSchema,
});
export const translationWorkspaceContextSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  snapshot: contentAuthoringSnapshotSchema,
  previousEnglish: translationPreviousEnglishSchema.nullable(),
  ownerArchived: z.boolean(),
});
export const translationWorkspaceContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    context: translationWorkspaceContextSchema,
  }),
  adminContentFailureSchema,
]);
const cell = z.discriminatedUnion("access", [
  z.strictObject({
    locale: supportedLocaleSchema,
    access: z.literal("RESTRICTED"),
  }),
  z.strictObject({
    locale: supportedLocaleSchema,
    access: z.literal("READABLE"),
    status: z.enum(["MISSING", "DRAFT", "IN_REVIEW", "APPROVED", "STALE"]),
    reviewStatus: z.enum(["DRAFT", "IN_REVIEW", "APPROVED"]).nullable(),
  }),
]);
export const translationWorkspaceResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("TRANSLATION_WORKSPACE"),
      target: baseContentTargetSchema,
      revisionNumber: z.number().int().positive(),
      authoringHeadVersion: z.number().int().positive(),
      contentHash: sourceHashSchema,
      lifecycle: revisionLifecycleSchema,
      cells: z
        .array(cell)
        .length(7)
        .refine((rows) =>
          rows.every((row, index) => row.locale === SUPPORTED_LOCALES[index]),
        ),
      source: baseContentTextSchema,
      selected: baseContentReviewResponseSchema.options[0].nullable(),
      sourceDiff: z.strictObject({
        status: z.enum(["CURRENT", "AVAILABLE", "UNAVAILABLE"]),
        previous: translationPreviousEnglishSchema.nullable(),
        changedPaths: z.array(z.string().max(256)).max(256),
      }),
      editability: z.strictObject({
        canSave: z.boolean(),
        reason: z.enum([
          "ALLOWED",
          "FORBIDDEN",
          "COPY_SCOPE_REQUIRED",
          "ARCHIVED",
        ]),
        requiredLocales: z.array(supportedLocaleSchema).max(7),
      }),
    })
    .superRefine((value, context) => {
      const selectedCell = value.cells.find(
        (row) => row.locale === value.target.locale,
      );
      const inconsistentCell = value.cells.some(
        (row) =>
          row.access === "READABLE" &&
          ((row.status === "MISSING") !== (row.reviewStatus === null) ||
            (row.status !== "MISSING" &&
              row.status !== "STALE" &&
              row.status !== row.reviewStatus)),
      );
      const selectedTarget = value.selected?.context.target;
      if (
        inconsistentCell ||
        selectedCell?.access !== "READABLE" ||
        (selectedCell.status === "MISSING") !== (value.selected === null) ||
        value.source.kind !== value.target.owner.kind ||
        value.revisionNumber > value.authoringHeadVersion ||
        value.editability.canSave !==
          (value.editability.reason === "ALLOWED") ||
        new Set(value.editability.requiredLocales).size !==
          value.editability.requiredLocales.length ||
        !value.editability.requiredLocales.includes(value.target.locale) ||
        (value.sourceDiff.status === "AVAILABLE") !==
          (value.sourceDiff.previous !== null) ||
        (value.sourceDiff.status !== "AVAILABLE" &&
          value.sourceDiff.changedPaths.length > 0) ||
        (value.sourceDiff.previous !== null &&
          value.sourceDiff.previous.text.kind !== value.source.kind) ||
        (selectedTarget !== undefined &&
          JSON.stringify(selectedTarget).toLowerCase() !==
            JSON.stringify(value.target).toLowerCase()) ||
        (value.selected !== null &&
          (JSON.stringify(value.selected.source) !==
            JSON.stringify(value.source) ||
            value.selected.context.audit.review.status !==
              selectedCell.reviewStatus ||
            value.selected.context.stale !== (selectedCell.status === "STALE")))
      )
        context.addIssue({
          code: "custom",
          message:
            "workspace projection must preserve canonical target, source, locale and editability",
        });
    }),
  adminContentFailureSchema,
]);
export type TranslationWorkspaceCommand = z.infer<
  typeof translationWorkspaceCommandSchema
>;
export type TranslationWorkspaceRequest = z.infer<
  typeof translationWorkspaceRequestSchema
>;
export type TranslationPreviousEnglish = z.infer<
  typeof translationPreviousEnglishSchema
>;
export type TranslationWorkspaceContext = z.infer<
  typeof translationWorkspaceContextSchema
>;
export type TranslationWorkspaceContextResponse = z.infer<
  typeof translationWorkspaceContextResponseSchema
>;
export type TranslationWorkspaceResponse = z.infer<
  typeof translationWorkspaceResponseSchema
>;
