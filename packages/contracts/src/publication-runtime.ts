import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { SUPPORTED_LOCALES, supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import {
  adminContentFailureSchema,
  adminContentRequestSchema,
  adminPrincipalSchema,
} from "./admin-content.js";
import {
  publicationPreflightTargetSchema,
  publicationPreflightContextSchema,
  publicationPreflightIssueSchema,
} from "./publication-preflight.js";
import { publicationManifestSchema } from "./publication-manifest.js";
import { publicationPurgeJobSchema } from "./publication-purge.js";

const version = schemaVersionSchema;
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
export const publicationAuthorizationCommandSchema = z.strictObject({
  schemaVersion: version,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  permission: z.enum(["content.read", "content.publish"]),
  locales: z
    .array(supportedLocaleSchema)
    .length(7)
    .refine((values) =>
      SUPPORTED_LOCALES.every((locale) => values.includes(locale)),
    ),
});
export const publicationRevisionCommandSchema = z.strictObject({
  schemaVersion: version,
  action: z.enum(["VALIDATE", "PUBLISH", "ROLLBACK"]),
  target: publicationPreflightTargetSchema,
  expectedVersion: sequence,
  expectedContentHash: sourceHashSchema,
  reasonCode: reason,
  idempotencyKey: idempotencyKeySchema,
});
export const publicationStatusCommandSchema = z.strictObject({
  schemaVersion: version,
  action: z.literal("STATUS"),
  publicationId: z.uuid(),
});
export const publicationRetryCommandSchema = z.strictObject({
  schemaVersion: version,
  action: z.literal("RETRY_PURGE"),
  publicationId: z.uuid(),
  purgeJobId: z.uuid(),
  expectedVersion: sequence.min(1),
  reasonCode: reason,
  idempotencyKey: idempotencyKeySchema,
});
export const publicationRuntimeCommandSchema = z.union([
  publicationRevisionCommandSchema,
  publicationStatusCommandSchema,
  publicationRetryCommandSchema,
]);
export const publicationRuntimeRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: publicationRuntimeCommandSchema });
export const publicationRuntimeIssueSchema =
  publicationPreflightIssueSchema.extend({
    code: z.union([
      publicationPreflightIssueSchema.shape.code,
      z.enum(["MEDIA_METADATA_PUBLICATION_REQUIRED", "MANIFEST_MISMATCH"]),
    ]),
  });
export const publicationRuntimeMutationSchema = z
  .strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("PUBLICATION_MUTATION"),
    resultId: z.uuid(),
    action: z.enum(["VALIDATE", "PUBLISH", "ROLLBACK"]),
    target: publicationPreflightTargetSchema,
    headVersion: sequence,
    contentHash: sourceHashSchema,
    publicationId: z.uuid().nullable(),
    manifestHash: sourceHashSchema.nullable(),
    replayed: z.boolean(),
  })
  .superRefine((result, context) => {
    if (
      (result.action === "VALIDATE") !==
        (result.publicationId === null && result.manifestHash === null) ||
      (result.action !== "VALIDATE" &&
        (result.publicationId === null || result.manifestHash === null))
    )
      context.addIssue({
        code: "custom",
        message: "only actual publication carries a publication and manifest",
        path: ["publicationId"],
      });
  });
export const publicationPurgeRetryResultSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("SUCCESS"),
  kind: z.literal("PURGE_RETRY"),
  resultId: z.uuid(),
  publicationId: z.uuid(),
  purgeJobId: z.uuid(),
  generation: sequence.min(2),
  version: sequence.min(1),
  replayed: z.boolean(),
});
export const publicationStatusResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("PUBLICATION_STATUS"),
      publicationId: z.uuid(),
      target: publicationPreflightTargetSchema,
      headVersion: sequence.min(1),
      manifestHash: sourceHashSchema,
      publishedAt: contentTimestampSchema,
      isCurrent: z.boolean(),
      jobs: z.array(publicationPurgeJobSchema).min(7),
    })
    .superRefine((response, context) => {
      const roots = response.jobs.filter((job) => job.generation === 1);
      if (
        roots.length !== 7 ||
        SUPPORTED_LOCALES.some(
          (locale) => roots.filter((job) => job.locale === locale).length !== 1,
        )
      )
        context.addIssue({
          code: "custom",
          message: "status contains every locale root exactly once",
          path: ["jobs"],
        });
      if (
        new Set(response.jobs.map((job) => job.id.toLowerCase())).size !==
          response.jobs.length ||
        response.jobs.some(
          (job) =>
            job.publicationId.toLowerCase() !==
            response.publicationId.toLowerCase(),
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "status jobs belong to this publication with unique identities",
          path: ["jobs"],
        });
      for (const job of response.jobs.filter((item) => item.retryOf !== null)) {
        const parent = response.jobs.find(
          (item) => item.id.toLowerCase() === job.retryOf?.toLowerCase(),
        );
        if (
          !parent ||
          parent.locale !== job.locale ||
          parent.outboxEventId.toLowerCase() !==
            job.outboxEventId.toLowerCase() ||
          parent.generation + 1 !== job.generation ||
          parent.status !== "FAILED"
        )
          context.addIssue({
            code: "custom",
            message: "retry history must retain the exact failed predecessor",
            path: ["jobs"],
          });
      }
    }),
  adminContentFailureSchema,
]);
export const publicationRuntimeResponseSchema = z.union([
  publicationRuntimeMutationSchema,
  publicationPurgeRetryResultSchema,
  publicationStatusResponseSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("FAILURE"),
    code: z.literal("PUBLICATION_BLOCKED"),
    issues: z.array(publicationRuntimeIssueSchema).min(1),
  }),
]);
export const publicationRuntimeContextSchema = z.strictObject({
  schemaVersion: version,
  preflight: publicationPreflightContextSchema,
  previousManifest: publicationManifestSchema.nullable(),
  mediaPublications: z.array(
    z.strictObject({
      mediaAssetId: z.uuid(),
      revisionId: z.uuid(),
      publicationId: z.uuid(),
    }),
  ),
});
export const publicationRuntimeContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    context: publicationRuntimeContextSchema,
  }),
  adminContentFailureSchema,
]);
export const publicationRuntimeWriteCommandSchema = z.strictObject({
  schemaVersion: version,
  requestId: z.uuid(),
  principal: adminPrincipalSchema,
  command: publicationRevisionCommandSchema,
  manifest: publicationManifestSchema,
  manifestHash: sourceHashSchema,
});
export const publicationRuntimeReceiptReadCommandSchema = z.strictObject({
  schemaVersion: version,
  resultId: z.uuid(),
  actorId: z.uuid(),
});
export const publicationRuntimeRetryWriteCommandSchema = z.strictObject({
  schemaVersion: version,
  requestId: z.uuid(),
  principal: adminPrincipalSchema,
  command: publicationRetryCommandSchema,
});
export type PublicationAuthorizationCommand = z.infer<
  typeof publicationAuthorizationCommandSchema
>;
export type PublicationRevisionCommand = z.infer<
  typeof publicationRevisionCommandSchema
>;
export type PublicationStatusCommand = z.infer<
  typeof publicationStatusCommandSchema
>;
export type PublicationRetryCommand = z.infer<
  typeof publicationRetryCommandSchema
>;
export type PublicationRuntimeCommand = z.infer<
  typeof publicationRuntimeCommandSchema
>;
export type PublicationRuntimeRequest = z.infer<
  typeof publicationRuntimeRequestSchema
>;
export type PublicationRuntimeResponse = z.infer<
  typeof publicationRuntimeResponseSchema
>;
export type PublicationRuntimeMutation = z.infer<
  typeof publicationRuntimeMutationSchema
>;
export type PublicationStatusResponse = z.infer<
  typeof publicationStatusResponseSchema
>;
export type PublicationRuntimeIssue = z.infer<
  typeof publicationRuntimeIssueSchema
>;
export type PublicationRuntimeContext = z.infer<
  typeof publicationRuntimeContextSchema
>;
export type PublicationRuntimeContextResponse = z.infer<
  typeof publicationRuntimeContextResponseSchema
>;
export type PublicationRuntimeWriteCommand = z.infer<
  typeof publicationRuntimeWriteCommandSchema
>;
export type PublicationRuntimeReceiptReadCommand = z.infer<
  typeof publicationRuntimeReceiptReadCommandSchema
>;
export type PublicationRuntimeRetryWriteCommand = z.infer<
  typeof publicationRuntimeRetryWriteCommandSchema
>;
