import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
  adminPrincipalSchema,
} from "./admin-content.js";
import { contentAuthoringTargetSchema } from "./content-authoring.js";
import {
  contentTimestampSchema,
  revisionLifecycleSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

const version = schemaVersionSchema;
const uuid = z.uuid();
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const kind = z.enum(["IDOL", "GIFT", "HOMEPAGE", "MEDIA_METADATA", "POLICY"]);
const status = z.enum(["draft", "active", "paused", "archived"]);
const pagination = {
  page: z.number().int().min(1).max(1000),
  pageSize: z.number().int().min(1).max(50),
};
const mutation = {
  idempotencyKey: idempotencyKeySchema,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
};
export const adminCatalogCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: version,
    action: z.literal("LIST_OWNERS"),
    kind,
    locale: supportedLocaleSchema,
    q: z.string().trim().min(1).max(160).optional(),
    status: status.optional(),
    ...pagination,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_OWNER"),
    target: contentAuthoringTargetSchema,
    locale: supportedLocaleSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_HISTORY"),
    target: contentAuthoringTargetSchema,
    history: z.enum(["REVISIONS", "PUBLICATIONS", "IDENTITY"]),
    ...pagination,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("CREATE_IDOL"),
    handle: slugSchema,
    expectedBaseVersion: z.literal(0),
    ...mutation,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("RENAME_IDOL"),
    idolId: uuid,
    newHandle: slugSchema,
    expectedBaseVersion: sequence.positive(),
    ...mutation,
  }),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("SET_IDOL_STATUS"),
      idolId: uuid,
      status: z.enum(["active", "paused", "archived"]),
      acceptingGifts: z.boolean(),
      expectedBaseVersion: sequence.positive(),
      ...mutation,
    })
    .refine((value) => !value.acceptingGifts || value.status === "active"),
]);
export const adminCatalogRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminCatalogCommandSchema,
});
export const adminCatalogOwnerSchema = z.strictObject({
  schemaVersion: version,
  target: contentAuthoringTargetSchema,
  locale: supportedLocaleSchema,
  label: z.string().max(300).nullable(),
  status: z.string().max(32),
  baseVersion: sequence.nullable(),
  authoringVersion: sequence,
  publicationHeadVersion: sequence,
  latestRevisionId: uuid.nullable(),
  draftRevisionId: uuid.nullable(),
  publishedRevisionId: uuid.nullable(),
  handle: slugSchema.nullable(),
  acceptingGifts: z.boolean().nullable(),
  createdAt: contentTimestampSchema.nullable(),
  media: z
    .strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      mimeType: z.string().max(64),
      processingStatus: z.enum([
        "PENDING",
        "PROCESSING",
        "READY",
        "FAILED",
        "ARCHIVED",
      ]),
      rightsStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]),
      identityKind: z.enum(["SOURCE", "PROCESSED_MASTER"]),
      latestProcessingJobId: uuid.nullable(),
    })
    .optional(),
});
export const adminCatalogRevisionSchema = z.strictObject({
  kind: z.literal("REVISION"),
  revisionId: uuid,
  revisionNumber: sequence.positive(),
  lifecycle: revisionLifecycleSchema,
  createdBy: uuid,
  createdAt: contentTimestampSchema,
  isCurrentPublished: z.boolean(),
  isDraftPointer: z.boolean(),
});
export const adminCatalogPublicationSchema = z.strictObject({
  kind: z.literal("PUBLICATION"),
  publicationId: uuid,
  revisionId: uuid,
  headVersion: sequence.positive(),
  action: z.enum(["PUBLISH", "ROLLBACK"]),
  actorId: uuid,
  publishedAt: contentTimestampSchema,
  isCurrent: z.boolean(),
});
export const adminCatalogIdentityEventSchema = z.strictObject({
  kind: z.literal("IDENTITY"),
  resultId: uuid,
  idolId: uuid,
  action: z.enum(["CREATE_IDOL", "RENAME_IDOL", "SET_IDOL_STATUS"]),
  expectedBaseVersion: sequence,
  resultBaseVersion: sequence.positive(),
  oldHandle: slugSchema.nullable(),
  newHandle: slugSchema,
  oldStatus: status.nullable(),
  newStatus: status,
  oldAcceptingGifts: z.boolean().nullable(),
  newAcceptingGifts: z.boolean(),
  actorId: uuid,
  createdAt: contentTimestampSchema,
  reasonCode: mutation.reasonCode,
});
export const adminCatalogMutationSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("SUCCESS"),
  kind: z.literal("MUTATION"),
  resultId: uuid,
  idolId: uuid,
  baseVersion: sequence.positive(),
  authoringVersion: sequence,
  publicationHeadVersion: sequence,
  handle: slugSchema,
  status,
  acceptingGifts: z.boolean(),
  draftRevisionId: uuid.nullable(),
  publishedRevisionId: uuid.nullable(),
  replayed: z.boolean(),
});
export const adminCatalogResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("OWNERS"),
    items: z.array(adminCatalogOwnerSchema).max(50),
    totalItems: sequence,
    ...pagination,
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("OWNER"),
    owner: adminCatalogOwnerSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    items: z
      .array(
        z.union([
          adminCatalogRevisionSchema,
          adminCatalogPublicationSchema,
          adminCatalogIdentityEventSchema,
        ]),
      )
      .max(50),
    totalItems: sequence,
    ...pagination,
  }),
  adminCatalogMutationSchema,
  adminContentFailureSchema,
]);
export const adminCatalogReadCommandSchema = z.discriminatedUnion("action", [
  adminCatalogCommandSchema.options[0],
  adminCatalogCommandSchema.options[1],
  adminCatalogCommandSchema.options[2],
]);
export const adminCatalogWriteCommandSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  principal: adminPrincipalSchema,
  command: z.discriminatedUnion("action", [
    adminCatalogCommandSchema.options[3],
    adminCatalogCommandSchema.options[4],
    adminCatalogCommandSchema.options[5],
  ]),
});
export const idolHandleResolutionCommandSchema = z.strictObject({
  schemaVersion: version,
  handle: slugSchema,
});
export const adminCatalogReceiptReadCommandSchema = z.strictObject({
  schemaVersion: version,
  resultId: uuid,
  actorId: uuid,
});
export const idolHandleResolutionSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("IDOL_HANDLE"),
    idolId: uuid,
    requestedHandle: slugSchema,
    currentHandle: slugSchema,
    redirectStatus: z.literal(301).nullable(),
  }),
  adminContentFailureSchema,
]);
export type AdminCatalogCommand = z.infer<typeof adminCatalogCommandSchema>;
export type AdminCatalogRequest = z.infer<typeof adminCatalogRequestSchema>;
export type AdminCatalogOwner = z.infer<typeof adminCatalogOwnerSchema>;
export type AdminCatalogResponse = z.infer<typeof adminCatalogResponseSchema>;
export type AdminCatalogMutation = z.infer<typeof adminCatalogMutationSchema>;
export type AdminCatalogReadCommand = z.infer<
  typeof adminCatalogReadCommandSchema
>;
export type AdminCatalogWriteCommand = z.infer<
  typeof adminCatalogWriteCommandSchema
>;
export type IdolHandleResolutionCommand = z.infer<
  typeof idolHandleResolutionCommandSchema
>;
export type IdolHandleResolution = z.infer<typeof idolHandleResolutionSchema>;
