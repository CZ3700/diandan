import { z } from "zod";
import {
  adminContentFailureSchema,
  adminContentRequestSchema,
  adminMutationResponseSchema,
  adminOpaqueTokenSchema,
  contentPreviewGrantResponseSchema,
  revokeContentPreviewCommandSchema,
} from "./admin-content.js";
import {
  contentAuthoringContentSchema,
  contentAuthoringSnapshotSchema,
  contentAuthoringTargetSchema,
} from "./content-authoring.js";
import {
  sourceHashSchema,
  contentTimestampSchema,
  revisionLifecycleSchema,
} from "./content-lifecycle.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { idolAliasSchema } from "./content-drafts.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
} from "./gift-details.js";

const version = schemaVersionSchema;
const uuid = z.uuid();
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
export const baseContentTargetSchema = z.strictObject({
  owner: contentAuthoringTargetSchema,
  revisionId: uuid,
  locale: supportedLocaleSchema,
});
const [idol, gift, homepage, policy, media] =
  contentAuthoringContentSchema.options;
const idolFields = idol.shape.translations.element.shape.fields;
const giftFields = gift.shape.translations.element.shape.fields;
const homepageFields = homepage.shape.translations.element.shape.fields;
const policyFields = policy.shape.translations.element.shape.fields;
const mediaFields = media.shape.translations.element.shape.fields;
export const baseContentTextSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: idol.shape.kind, fields: idolFields }),
  z.strictObject({ kind: gift.shape.kind, fields: giftFields }),
  z.strictObject({ kind: homepage.shape.kind, fields: homepageFields }),
  z.strictObject({ kind: policy.shape.kind, fields: policyFields }),
  z.strictObject({ kind: media.shape.kind, fields: mediaFields }),
]);
// Explicit private preview data; these references grant no access to linked drafts or storage objects.
export const baseContentLocalizedSchema = z.discriminatedUnion("kind", [
  idol
    .pick({ kind: true, structure: true, media: true })
    .extend({ fields: idolFields }),
  gift
    .pick({ kind: true, structure: true, media: true })
    .extend({ fields: giftFields }),
  homepage
    .pick({ kind: true, structure: true })
    .extend({ fields: homepageFields }),
  policy.pick({ kind: true, structure: true }).extend({ fields: policyFields }),
  media.pick({ kind: true, structure: true }).extend({ fields: mediaFields }),
]);
export const baseContentReviewContextSchema = z
  .strictObject({
    schemaVersion: version,
    target: baseContentTargetSchema,
    structureEditorId: uuid,
    lifecycle: revisionLifecycleSchema,
    audit: contentAuthoringSnapshotSchema.shape.translationAudits.element,
    currentEnglishSourceHash: sourceHashSchema,
    stale: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.audit.locale !== value.target.locale ||
      value.stale !==
        (value.audit.translatedFromSourceHash !==
          value.currentEnglishSourceHash)
    )
      context.addIssue({
        code: "custom",
        message:
          "review locale and stale provenance must match canonical evidence",
      });
  });
export const baseContentReviewReadCommandSchema = z.strictObject({
  schemaVersion: version,
  target: baseContentTargetSchema,
});
export const baseContentReviewResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("REVIEW"),
      context: baseContentReviewContextSchema,
      content: baseContentLocalizedSchema,
      source: baseContentTextSchema,
    })
    .superRefine((value, context) => {
      if (
        value.context.target.owner.kind !== value.content.kind ||
        value.source.kind !== value.content.kind
      )
        context.addIssue({
          code: "custom",
          message: "review and English source must match target kind",
        });
    }),
  adminContentFailureSchema,
]);
const reviewFields = {
  target: baseContentTargetSchema,
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  expectedContentHash: sourceHashSchema,
  expectedSourceHash: sourceHashSchema,
  reasonCode: reason,
};
export const appendBaseContentReviewCommandSchema = z.strictObject({
  schemaVersion: version,
  action: z.enum(["SUBMIT", "APPROVE"]),
  ...reviewFields,
  actorId: uuid,
  requestId: uuid,
});
const previewContent = z.discriminatedUnion("kind", [
  baseContentLocalizedSchema.options[0].extend({
    aliases: z.array(idolAliasSchema).max(64).optional(),
  }),
  baseContentLocalizedSchema.options[1].extend({
    details: z
      .strictObject({
        document: giftDetailDocumentSchema,
        translation: giftDetailTranslationFieldsSchema,
      })
      .optional(),
  }),
  baseContentLocalizedSchema.options[2],
  baseContentLocalizedSchema.options[3],
  baseContentLocalizedSchema.options[4],
]);
export const baseContentPreviewResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      target: baseContentTargetSchema,
      content: previewContent,
    })
    .superRefine((value, context) => {
      if (value.target.owner.kind !== value.content.kind)
        context.addIssue({
          code: "custom",
          message: "preview must match grant kind",
        });
      if (
        value.content.kind === "IDOL" &&
        value.content.aliases?.some(
          (alias) =>
            alias.locale !== null && alias.locale !== value.target.locale,
        )
      )
        context.addIssue({
          code: "custom",
          message: "preview aliases must match grant locale",
        });
      if (
        value.content.kind === "GIFT" &&
        value.content.details &&
        value.content.details.document.giftRevisionId.toLowerCase() !==
          value.target.revisionId.toLowerCase()
      )
        context.addIssue({
          code: "custom",
          message: "preview details must match grant revision",
        });
    }),
  adminContentFailureSchema,
]);
export const issueBaseContentPreviewCommandSchema = z.strictObject({
  schemaVersion: version,
  target: baseContentTargetSchema,
  tokenDigest: sourceHashSchema,
  actorId: uuid,
  sessionId: uuid,
  ttlSeconds: z.number().int().min(60).max(900),
  reasonCode: reason,
  requestId: uuid,
});
export const readBaseContentPreviewCommandSchema = z.strictObject({
  schemaVersion: version,
  target: baseContentTargetSchema,
  tokenDigest: sourceHashSchema,
});
export const revokeBaseContentPreviewCommandSchema =
  revokeContentPreviewCommandSchema;
export const baseContentPreviewGrantResponseSchema =
  contentPreviewGrantResponseSchema;
export const baseContentPreviewRequestSchema = z.strictObject({
  schemaVersion: version,
  target: baseContentTargetSchema,
  token: adminOpaqueTokenSchema,
});
export const baseContentCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_REVIEW"),
    target: baseContentTargetSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("SUBMIT_REVIEW"),
    ...reviewFields,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("APPROVE_REVIEW"),
    ...reviewFields,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ISSUE_PREVIEW"),
    target: baseContentTargetSchema,
    ttlSeconds: z.number().int().min(60).max(900),
    reasonCode: reason,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("REVOKE_PREVIEW"),
    grantId: uuid,
    reasonCode: reason,
    idempotencyKey: idempotencyKeySchema,
  }),
]);
export const baseContentRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: baseContentCommandSchema });
export const baseContentResponseSchema = z.union([
  baseContentReviewResponseSchema,
  adminMutationResponseSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("PREVIEW_GRANT"),
    grantId: uuid,
    token: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
  }),
]);

export type BaseContentTarget = z.infer<typeof baseContentTargetSchema>;
export type BaseContentText = z.infer<typeof baseContentTextSchema>;
export type BaseContentLocalized = z.infer<typeof baseContentLocalizedSchema>;
export type BaseContentReviewContext = z.infer<
  typeof baseContentReviewContextSchema
>;
export type BaseContentReviewReadCommand = z.infer<
  typeof baseContentReviewReadCommandSchema
>;
export type BaseContentReviewResponse = z.infer<
  typeof baseContentReviewResponseSchema
>;
export type AppendBaseContentReviewCommand = z.infer<
  typeof appendBaseContentReviewCommandSchema
>;
export type BaseContentPreviewResponse = z.infer<
  typeof baseContentPreviewResponseSchema
>;
export type IssueBaseContentPreviewCommand = z.infer<
  typeof issueBaseContentPreviewCommandSchema
>;
export type ReadBaseContentPreviewCommand = z.infer<
  typeof readBaseContentPreviewCommandSchema
>;
export type RevokeBaseContentPreviewCommand = z.infer<
  typeof revokeBaseContentPreviewCommandSchema
>;
export type BaseContentPreviewGrantResponse = z.infer<
  typeof baseContentPreviewGrantResponseSchema
>;
export type BaseContentPreviewRequest = z.infer<
  typeof baseContentPreviewRequestSchema
>;
export type BaseContentCommand = z.infer<typeof baseContentCommandSchema>;
export type BaseContentRequest = z.infer<typeof baseContentRequestSchema>;
export type BaseContentResponse = z.infer<typeof baseContentResponseSchema>;
