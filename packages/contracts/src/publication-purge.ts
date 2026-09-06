import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import {
  cachePurgePathSchema,
  cachePurgePortErrorCodeSchema,
} from "./cache-purge-port-contracts.js";
import { portOpaqueReferenceSchema } from "./port-common.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { adminContentFailureSchema } from "./admin-content.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference = portOpaqueReferenceSchema;
export const publicationPurgeErrorCodeSchema = z.union([
  cachePurgePortErrorCodeSchema,
  z.enum(["PURGE_TIMEOUT", "INVALID_PROVIDER_RESPONSE"]),
]);
/** Public administration status never contains provider payloads or references. */
export const publicationPurgeJobSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: z.uuid(),
    publicationId: z.uuid(),
    outboxEventId: z.uuid(),
    locale: supportedLocaleSchema,
    generation: integer.min(1),
    retryOf: z.uuid().nullable(),
    status: z.enum(["PENDING", "SUBMITTED", "COMPLETED", "FAILED"]),
    version: integer.min(1),
    attemptCount: integer,
    failureCount: integer,
    createdAt: contentTimestampSchema,
    updatedAt: contentTimestampSchema,
    nextAttemptAt: contentTimestampSchema.nullable(),
    completedAt: contentTimestampSchema.nullable(),
    errorCode: publicationPurgeErrorCodeSchema.nullable(),
  })
  .superRefine((job, context) => {
    if ((job.status === "COMPLETED") !== (job.completedAt !== null))
      context.addIssue({
        code: "custom",
        message: "completion requires actual purge evidence",
        path: ["completedAt"],
      });
    if ((job.generation === 1) !== (job.retryOf === null))
      context.addIssue({
        code: "custom",
        message: "retry generations retain their predecessor",
        path: ["retryOf"],
      });
  });
export const publicationPurgeClaimCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  leaseSeconds: z.number().int().min(10).max(300),
});
export const publicationPurgeClaimSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    job: publicationPurgeJobSchema,
    leaseToken: z.uuid(),
    version: integer.min(1),
    purgeReference: reference.nullable(),
    paths: z.array(cachePurgePathSchema).min(1).max(3000),
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((claim, context) => {
    if (claim.version !== claim.job.version)
      context.addIssue({
        code: "custom",
        message: "fence must match claimed job",
        path: ["version"],
      });
    if (claim.job.status !== "PENDING" && claim.job.status !== "SUBMITTED")
      context.addIssue({
        code: "custom",
        message: "terminal jobs cannot be claimed",
        path: ["job", "status"],
      });
    if ((claim.job.status === "SUBMITTED") !== (claim.purgeReference !== null))
      context.addIssue({
        code: "custom",
        message: "only submitted jobs have a purge reference",
        path: ["purgeReference"],
      });
  });
export const publicationPurgeClaimResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    claim: publicationPurgeClaimSchema.nullable(),
  }),
  adminContentFailureSchema,
]);
export const publicationPurgeRecordCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  jobId: z.uuid(),
  leaseToken: z.uuid(),
  expectedVersion: integer.min(1),
  result: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("SUBMITTED"), purgeReference: reference }),
    z.strictObject({ kind: z.literal("PENDING") }),
    z.strictObject({ kind: z.literal("COMPLETED"), purgeReference: reference }),
    z.strictObject({
      kind: z.literal("FAILURE"),
      code: publicationPurgeErrorCodeSchema,
      retryable: z.boolean(),
    }),
  ]),
});
export const publicationPurgeRecordResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    job: publicationPurgeJobSchema,
  }),
  adminContentFailureSchema,
]);
export const publicationPurgeRunResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("IDLE"),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("RECORDED"),
    jobId: z.uuid(),
    status: z.enum(["PENDING", "SUBMITTED", "COMPLETED", "FAILED"]),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("UNAVAILABLE"),
  }),
]);
export type PublicationPurgeJob = z.infer<typeof publicationPurgeJobSchema>;
export type PublicationPurgeClaimCommand = z.infer<
  typeof publicationPurgeClaimCommandSchema
>;
export type PublicationPurgeClaim = z.infer<typeof publicationPurgeClaimSchema>;
export type PublicationPurgeClaimResponse = z.infer<
  typeof publicationPurgeClaimResponseSchema
>;
export type PublicationPurgeRecordCommand = z.infer<
  typeof publicationPurgeRecordCommandSchema
>;
export type PublicationPurgeRecordResponse = z.infer<
  typeof publicationPurgeRecordResponseSchema
>;
export type PublicationPurgeRunResult = z.infer<
  typeof publicationPurgeRunResultSchema
>;
