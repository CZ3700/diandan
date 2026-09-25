import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import {
  createIdolAliasDraftCommandSchema,
  createGiftDetailDraftCommandSchema,
  contentDraftReadCommandSchema,
  contentDraftResponseSchema,
  idolAliasSchema,
} from "./content-drafts.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
} from "./gift-details.js";

const version = schemaVersionSchema;
const uuid = z.uuid();
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
export const adminOpaqueTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
export const adminContentFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "CSRF_INVALID",
    "NOT_FOUND",
    "REVISION_NOT_DRAFT",
    "ALREADY_EXISTS",
    "INVALID_CONTENT",
    "CONTENT_UNAVAILABLE",
    "STALE_CONTENT",
    "STALE_VERSION",
    "SELF_REVIEW",
    "INVALID_REVIEW_STATE",
    "IDEMPOTENCY_CONFLICT",
    "CONFLICT",
    "PREVIEW_UNAVAILABLE",
  ]),
});
export const adminContentPermissionSchema = z.enum([
  "content.read",
  "content.edit",
  "content.translation.review",
  "content.preview",
]);
export const adminAuthorizationCommandSchema = z.strictObject({
  schemaVersion: version,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  permission: adminContentPermissionSchema,
  locales: z
    .array(supportedLocaleSchema)
    .max(7)
    .refine((v) => new Set(v).size === v.length),
});
export const adminPrincipalSchema = z.strictObject({
  schemaVersion: version,
  actorId: uuid,
  sessionId: uuid,
  expiresAt: contentTimestampSchema,
  authorizedAt: contentTimestampSchema,
});
export const adminAuthorizationResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    principal: adminPrincipalSchema,
  }),
  adminContentFailureSchema,
]);
export const contentReviewTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("IDOL_ALIASES"), revisionId: uuid }),
  z.strictObject({
    kind: z.literal("GIFT_DETAILS"),
    revisionId: uuid,
    locale: supportedLocaleSchema,
  }),
]);
export const contentReviewContextSchema = z.strictObject({
  schemaVersion: version,
  target: contentReviewTargetSchema,
  subjectId: uuid,
  sequence,
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED"]),
  editorId: uuid,
  structureEditorId: uuid,
  editedAt: contentTimestampSchema,
  contentHash: sourceHashSchema,
  sourceHash: sourceHashSchema.nullable(),
  locales: z.array(supportedLocaleSchema).max(7),
});
export const contentReviewContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    context: contentReviewContextSchema,
  }),
  adminContentFailureSchema,
]);
const reviewFields = {
  target: contentReviewTargetSchema,
  expectedVersion: sequence,
  expectedContentHash: sourceHashSchema,
  expectedSourceHash: sourceHashSchema.nullable(),
  reasonCode: reason,
};
function validReviewSource(value: {
  target: { kind: string };
  expectedSourceHash: string | null;
}) {
  return (
    (value.target.kind === "IDOL_ALIASES") ===
    (value.expectedSourceHash === null)
  );
}
export const contentReviewReadCommandSchema = z.strictObject({
  schemaVersion: version,
  target: contentReviewTargetSchema,
});
export const appendContentReviewCommandSchema = z
  .strictObject({
    schemaVersion: version,
    action: z.enum(["SUBMIT", "APPROVE"]),
    ...reviewFields,
    actorId: uuid,
    requestId: uuid,
  })
  .refine(validReviewSource, "source hash applies only to translated details");
export const adminMutationResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("MUTATION"),
    resultId: uuid,
    replayed: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const contentPreviewTargetSchema = z.strictObject({
  kind: z.enum(["IDOL_ALIASES", "GIFT_DETAILS"]),
  revisionId: uuid,
  locale: supportedLocaleSchema,
});
export const issueContentPreviewCommandSchema = z.strictObject({
  schemaVersion: version,
  target: contentPreviewTargetSchema,
  tokenDigest: sourceHashSchema,
  actorId: uuid,
  sessionId: uuid,
  ttlSeconds: z.number().int().min(60).max(900),
  reasonCode: reason,
  requestId: uuid,
});
export const contentPreviewGrantResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    grantId: uuid,
    createdAt: contentTimestampSchema,
    expiresAt: contentTimestampSchema,
  }),
  adminContentFailureSchema,
]);
export const readContentPreviewCommandSchema = z.strictObject({
  schemaVersion: version,
  target: contentPreviewTargetSchema,
  tokenDigest: sourceHashSchema,
});
export const revokeContentPreviewCommandSchema = z.strictObject({
  schemaVersion: version,
  grantId: uuid,
  actorId: uuid,
  reasonCode: reason,
  requestId: uuid,
});
export const contentPreviewRequestSchema = z.strictObject({
  schemaVersion: version,
  target: contentPreviewTargetSchema,
  token: adminOpaqueTokenSchema,
});
export const contentPreviewContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("IDOL_ALIASES"),
    aliases: z.array(idolAliasSchema).max(64),
  }),
  z.strictObject({
    kind: z.literal("GIFT_DETAILS"),
    document: giftDetailDocumentSchema,
    translation: giftDetailTranslationFieldsSchema,
  }),
]);
export const contentPreviewResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      target: contentPreviewTargetSchema,
      content: contentPreviewContentSchema,
    })
    .superRefine((value, context) => {
      if (value.target.kind !== value.content.kind)
        context.addIssue({
          code: "custom",
          message: "preview kind must match grant scope",
        });
      if (
        value.content.kind === "IDOL_ALIASES" &&
        value.content.aliases.some(
          (alias) =>
            alias.locale !== null && alias.locale !== value.target.locale,
        )
      )
        context.addIssue({
          code: "custom",
          message: "preview aliases must match grant locale",
        });
      if (
        value.content.kind === "GIFT_DETAILS" &&
        value.content.document.giftRevisionId.toLowerCase() !==
          value.target.revisionId.toLowerCase()
      )
        context.addIssue({
          code: "custom",
          message: "preview revision must match grant scope",
        });
    }),
  adminContentFailureSchema,
]);
export const contentReviewResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("REVIEW"),
      context: contentReviewContextSchema,
      content: contentPreviewContentSchema,
      source: giftDetailTranslationFieldsSchema.nullable(),
    })
    .superRefine((value, ctx) => {
      if (
        value.context.target.kind !== value.content.kind ||
        (value.content.kind === "IDOL_ALIASES") !== (value.source === null)
      )
        ctx.addIssue({
          code: "custom",
          message: "review content and source must match canonical target",
        });
      if (
        value.content.kind === "GIFT_DETAILS" &&
        value.content.document.giftRevisionId.toLowerCase() !==
          value.context.target.revisionId.toLowerCase()
      )
        ctx.addIssue({
          code: "custom",
          message: "review document must match canonical revision",
        });
    }),
  adminContentFailureSchema,
]);
const writes = { idempotencyKey: idempotencyKeySchema };
export const adminContentCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_REVIEW"),
    target: contentReviewTargetSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_DRAFT"),
    target: contentDraftReadCommandSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("CREATE_IDOL_ALIASES"),
    draft: createIdolAliasDraftCommandSchema.omit({
      actorId: true,
      requestId: true,
    }),
    expectedVersion: z.literal(1),
    ...writes,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("CREATE_GIFT_DETAILS"),
    draft: createGiftDetailDraftCommandSchema.omit({
      actorId: true,
      requestId: true,
    }),
    expectedVersion: z.literal(1),
    ...writes,
  }),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("SUBMIT_REVIEW"),
      ...reviewFields,
      ...writes,
    })
    .refine(validReviewSource),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("APPROVE_REVIEW"),
      ...reviewFields,
      ...writes,
    })
    .refine(validReviewSource),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ISSUE_PREVIEW"),
    target: contentPreviewTargetSchema,
    ttlSeconds: z.number().int().min(60).max(900),
    reasonCode: reason,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("REVOKE_PREVIEW"),
    grantId: uuid,
    reasonCode: reason,
    ...writes,
  }),
]);
export const adminContentRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminContentCommandSchema,
});
export const adminContentResponseSchema = z.union([
  contentReviewResponseSchema,
  adminMutationResponseSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("DRAFT"),
    content: contentDraftResponseSchema.refine(
      (value) => value.outcome === "SUCCESS",
    ),
    reviews: z.array(contentReviewContextSchema).max(7),
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("PREVIEW_GRANT"),
    grantId: uuid,
    token: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
  }),
]);
export type AdminContentFailure = z.infer<typeof adminContentFailureSchema>;
export type AdminAuthorizationCommand = z.infer<
  typeof adminAuthorizationCommandSchema
>;
export type AdminAuthorizationResponse = z.infer<
  typeof adminAuthorizationResponseSchema
>;
export type AdminPrincipal = z.infer<typeof adminPrincipalSchema>;
export type ContentReviewTarget = z.infer<typeof contentReviewTargetSchema>;
export type ContentReviewContext = z.infer<typeof contentReviewContextSchema>;
export type ContentReviewContextResponse = z.infer<
  typeof contentReviewContextResponseSchema
>;
export type AppendContentReviewCommand = z.infer<
  typeof appendContentReviewCommandSchema
>;
export type AdminMutationResponse = z.infer<typeof adminMutationResponseSchema>;
export type ContentPreviewTarget = z.infer<typeof contentPreviewTargetSchema>;
export type IssueContentPreviewCommand = z.infer<
  typeof issueContentPreviewCommandSchema
>;
export type ContentPreviewGrantResponse = z.infer<
  typeof contentPreviewGrantResponseSchema
>;
export type ReadContentPreviewCommand = z.infer<
  typeof readContentPreviewCommandSchema
>;
export type RevokeContentPreviewCommand = z.infer<
  typeof revokeContentPreviewCommandSchema
>;
export type ContentPreviewRequest = z.infer<typeof contentPreviewRequestSchema>;
export type ContentPreviewResponse = z.infer<
  typeof contentPreviewResponseSchema
>;
export type AdminContentCommand = z.infer<typeof adminContentCommandSchema>;
export type AdminContentRequest = z.infer<typeof adminContentRequestSchema>;
export type AdminContentResponse = z.infer<typeof adminContentResponseSchema>;

export type ContentReviewReadCommand = z.infer<
  typeof contentReviewReadCommandSchema
>;

export type ContentReviewResponse = z.infer<typeof contentReviewResponseSchema>;
