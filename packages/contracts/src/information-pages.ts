import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
  adminAuthorizationCommandSchema,
} from "./admin-content.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { SUPPORTED_LOCALES, supportedLocaleSchema } from "./locale.js";

export const INFORMATION_PAGE_KEYS = ["ABOUT", "FAQ", "SUPPORT"] as const;
export const informationPageKeySchema = z.enum(INFORMATION_PAGE_KEYS);
const uuid = z.uuid();
const version = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
// Plain text is rendered literally: entity-looking text is not decoded as markup.
const invisibleText =
  // eslint-disable-next-line no-control-regex, no-misleading-character-class -- Individual invisible code points mirror the PostgreSQL plain-text validator.
  /[\u0001-\u0020\u007F-\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/gu;
const safeText = (value: string) =>
  // eslint-disable-next-line no-control-regex -- Reject C0/C1 and lone surrogates before PostgreSQL JSON/text encoding.
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(
    value,
  ) && !/<\/?[A-Za-z!][^>]*>/u.test(value);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(safeText, "Use plain text without markup or control characters");
const plain = (max: number) =>
  optionalText(max).refine(
    (v) => v.replace(invisibleText, "").length > 0,
    "Text must contain a visible character",
  );
export const informationPageStructureSchema = z.strictObject({
  sectionIds: z
    .array(uuid)
    .min(1)
    .max(12)
    .refine((v) => new Set(v.map((id) => id.toLowerCase())).size === v.length),
  contactEmail: z
    .email()
    .max(254)
    .refine((v) => !/[\r\n?&#%]/u.test(v))
    .nullable(),
});
export const informationPageFieldsSchema = z.strictObject({
  title: plain(120),
  summary: optionalText(500),
  sections: z
    .array(
      z.strictObject({
        id: uuid,
        heading: optionalText(160),
        body: plain(4000),
      }),
    )
    .min(1)
    .max(12)
    .refine((v) => new Set(v.map((s) => s.id.toLowerCase())).size === v.length),
});
export function validInformationPageDocument(value: {
  pageKey: string;
  structure: z.infer<typeof informationPageStructureSchema>;
  fields: z.infer<typeof informationPageFieldsSchema>;
}) {
  return (
    (value.pageKey === "SUPPORT" || value.structure.contactEmail === null) &&
    value.fields.sections.length === value.structure.sectionIds.length &&
    value.fields.sections.every(
      (section, index) =>
        section.id.toLowerCase() ===
          value.structure.sectionIds[index]?.toLowerCase() &&
        (value.pageKey !== "FAQ" ||
          plain(160).safeParse(section.heading).success),
    )
  );
}
export const informationPagePreviewDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    pageKey: informationPageKeySchema,
    locale: supportedLocaleSchema,
    revisionId: uuid,
    structure: informationPageStructureSchema,
    fields: informationPageFieldsSchema,
    sourceStatus: z.literal("CURRENT"),
  })
  .refine(
    validInformationPageDocument,
    "Document must match its page and current structure",
  );
export const informationPagePreviewMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("INFORMATION_PAGE_PREVIEW_RENDER"),
  channel: uuid,
  document: informationPagePreviewDocumentSchema,
});
export const informationPagePreviewReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("INFORMATION_PAGE_PREVIEW_READY"),
  channel: uuid,
});
const target = {
  pageKey: informationPageKeySchema,
  locale: supportedLocaleSchema,
};
const mutation = {
  schemaVersion: z.literal(1),
  ...target,
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
const review = {
  ...mutation,
  revisionId: uuid,
  expectedContentHash: sourceHashSchema,
  expectedSourceHash: sourceHashSchema,
  expectedReviewSequence: z.number().int().min(1).max(3),
};
export const informationPageCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("LIST"),
    locale: supportedLocaleSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("READ"),
    ...target,
  }),
  z
    .strictObject({
      ...mutation,
      action: z.literal("SAVE_DRAFT"),
      revisionId: uuid.nullable(),
      expectedSourceHash: sourceHashSchema.nullable(),
      structure: informationPageStructureSchema.nullable(),
      fields: informationPageFieldsSchema,
    })
    .superRefine((v, c) => {
      if (
        (v.locale === "en") !== (v.structure !== null) ||
        (v.revisionId === null) !== (v.expectedSourceHash === null) ||
        (v.revisionId === null && v.locale !== "en") ||
        (v.structure !== null &&
          !validInformationPageDocument({ ...v, structure: v.structure }))
      )
        c.addIssue({
          code: "custom",
          message: "Source, structure and page must match the selected locale",
        });
    }),
  z.strictObject({ ...review, action: z.literal("SUBMIT_REVIEW") }),
  z.strictObject({ ...review, action: z.literal("APPROVE_REVIEW") }),
  z.strictObject({
    ...mutation,
    action: z.literal("PUBLISH"),
    revisionId: uuid,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("RESTORE"),
    publicationId: uuid,
  }),
  z.strictObject({ ...mutation, action: z.literal("UNPUBLISH") }),
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("HISTORY"),
    ...target,
    page: z.number().int().min(1).max(100000),
    pageSize: z.number().int().min(1).max(20),
  }),
]);
export const informationPageRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: informationPageCommandSchema,
});
export const informationPageAuthorizationCommandSchema =
  adminAuthorizationCommandSchema.extend({
    permission: z.enum([
      "content.read",
      "content.edit",
      "content.translation.review",
      "content.preview",
      "content.publish",
    ]),
  });
export const informationPagePublicationSchema = z
  .strictObject({
    publicationId: uuid,
    pageKey: informationPageKeySchema,
    revisionId: uuid.nullable(),
    version: version.min(1),
    action: z.enum(["PUBLISH", "RESTORE", "UNPUBLISH"]),
    restoredFromPublicationId: uuid.nullable(),
    publishedAt: contentTimestampSchema,
  })
  .refine(
    (v) =>
      (v.action === "UNPUBLISH") === (v.revisionId === null) &&
      (v.action === "RESTORE") === (v.restoredFromPublicationId !== null),
  );
export const informationPageReviewSchema = z
  .strictObject({
    status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED"]),
    sequence: z.number().int().min(1).max(3),
    reviewerId: uuid.nullable(),
    reviewedAt: contentTimestampSchema.nullable(),
  })
  .refine(
    (v) =>
      (v.status === "APPROVED") ===
      (v.reviewerId !== null && v.reviewedAt !== null),
  );
export const informationPageSelectedSchema = z.strictObject({
  translationId: uuid,
  fields: informationPageFieldsSchema,
  contentHash: sourceHashSchema,
  translatedFromSourceHash: sourceHashSchema,
  editorId: uuid,
  editedAt: contentTimestampSchema,
  review: informationPageReviewSchema,
});
export const informationPageCellSchema = z.discriminatedUnion("access", [
  z.strictObject({
    locale: supportedLocaleSchema,
    access: z.literal("RESTRICTED"),
  }),
  z.strictObject({
    locale: supportedLocaleSchema,
    access: z.literal("READABLE"),
    status: z.enum(["MISSING", "DRAFT", "IN_REVIEW", "APPROVED", "STALE"]),
  }),
]);
export const informationPageWorkspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...target,
  version,
  draft: z
    .strictObject({
      revisionId: uuid,
      createdAt: contentTimestampSchema,
      structure: informationPageStructureSchema,
      sourceHash: sourceHashSchema,
    })
    .nullable(),
  published: informationPagePublicationSchema.nullable(),
  cells: z
    .array(informationPageCellSchema)
    .length(7)
    .refine((v) => v.every((c, i) => c.locale === SUPPORTED_LOCALES[i])),
  source: informationPageFieldsSchema.nullable(),
  previousSource: informationPageFieldsSchema.nullable(),
  changedPaths: z.array(z.string().max(128)).max(64),
  selected: informationPageSelectedSchema.nullable(),
  capabilities: z.strictObject({
    canSave: z.boolean(),
    canSubmit: z.boolean(),
    canApprove: z.boolean(),
    canPublish: z.boolean(),
    canUnpublish: z.boolean(),
    canRestore: z.boolean(),
  }),
  blockers: z
    .array(
      z.strictObject({
        locale: supportedLocaleSchema,
        code: z.enum(["MISSING", "DRAFT", "IN_REVIEW", "STALE", "RESTRICTED"]),
      }),
    )
    .max(7),
  preview: informationPagePreviewDocumentSchema.nullable(),
});
export const informationPageListEntrySchema = z.strictObject({
  pageKey: informationPageKeySchema,
  version,
  draftRevisionId: uuid.nullable(),
  publishedPublicationId: uuid.nullable(),
});
export const informationPageResponseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("LIST"),
    entries: z.array(informationPageListEntrySchema).length(3),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STATE"),
    workspace: informationPageWorkspaceSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    entries: z.array(informationPagePublicationSchema).max(20),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    hasMore: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const publicInformationPageRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pageKey: informationPageKeySchema,
  locale: supportedLocaleSchema,
});
export const publicInformationPageIndexRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  locale: supportedLocaleSchema,
});
export const publicInformationPageResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("INFORMATION_PAGE"),
      document: informationPagePreviewDocumentSchema,
      publicationId: uuid,
      publishedAt: contentTimestampSchema,
      requestedLocale: supportedLocaleSchema,
      resolvedLocale: supportedLocaleSchema,
      fallbackUsed: z.boolean(),
      availableLocales: z.array(supportedLocaleSchema).max(7),
    })
    .refine(
      (v) =>
        v.document.locale === v.resolvedLocale &&
        v.availableLocales.includes(v.resolvedLocale) &&
        v.availableLocales.every(
          (l, i, a) =>
            i === 0 ||
            SUPPORTED_LOCALES.indexOf(a[i - 1]!) < SUPPORTED_LOCALES.indexOf(l),
        ) &&
        (v.fallbackUsed
          ? v.resolvedLocale === "en" &&
            v.requestedLocale !== "en" &&
            !v.availableLocales.includes(v.requestedLocale)
          : v.requestedLocale === v.resolvedLocale),
    ),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("FAILURE"),
    code: z.enum(["NOT_FOUND", "CONTENT_UNAVAILABLE", "INVALID_COMMAND"]),
  }),
]);
export const publicInformationPageIndexResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("INFORMATION_PAGE_INDEX"),
      locale: supportedLocaleSchema,
      entries: z
        .array(
          z.strictObject({
            pageKey: informationPageKeySchema,
            title: plain(120),
            publicationId: uuid,
            publishedAt: contentTimestampSchema,
            availableLocales: z.array(supportedLocaleSchema).max(7),
          }),
        )
        .max(3),
    })
    .refine(
      (v) =>
        new Set(v.entries.map((e) => e.pageKey)).size === v.entries.length &&
        v.entries.every(
          (e) =>
            e.availableLocales.includes(v.locale) &&
            e.availableLocales.every(
              (l, i, a) =>
                i === 0 ||
                SUPPORTED_LOCALES.indexOf(a[i - 1]!) <
                  SUPPORTED_LOCALES.indexOf(l),
            ),
        ),
    ),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("FAILURE"),
    code: z.enum(["CONTENT_UNAVAILABLE", "INVALID_COMMAND"]),
  }),
]);
export type InformationPageKey = z.infer<typeof informationPageKeySchema>;
export type InformationPageFields = z.infer<typeof informationPageFieldsSchema>;
export type InformationPageStructure = z.infer<
  typeof informationPageStructureSchema
>;
export type InformationPageCommand = z.infer<
  typeof informationPageCommandSchema
>;
export type InformationPageRequest = z.infer<
  typeof informationPageRequestSchema
>;
export type InformationPageResponse = z.infer<
  typeof informationPageResponseSchema
>;
export type InformationPageWorkspace = z.infer<
  typeof informationPageWorkspaceSchema
>;
export type InformationPagePublication = z.infer<
  typeof informationPagePublicationSchema
>;
export type InformationPageSelected = z.infer<
  typeof informationPageSelectedSchema
>;
export type InformationPageAuthorizationCommand = z.infer<
  typeof informationPageAuthorizationCommandSchema
>;
export type InformationPagePreviewDocument = z.infer<
  typeof informationPagePreviewDocumentSchema
>;
export type InformationPagePreviewMessage = z.infer<
  typeof informationPagePreviewMessageSchema
>;
export type PublicInformationPageRequest = z.infer<
  typeof publicInformationPageRequestSchema
>;
export type PublicInformationPageResponse = z.infer<
  typeof publicInformationPageResponseSchema
>;
export type PublicInformationPageIndexRequest = z.infer<
  typeof publicInformationPageIndexRequestSchema
>;
export type PublicInformationPageIndexResponse = z.infer<
  typeof publicInformationPageIndexResponseSchema
>;
