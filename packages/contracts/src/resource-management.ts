import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import {
  adminContentFailureSchema,
  adminMutationResponseSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import {
  mediaAssetSchema,
  mediaMimeTypeSchema,
  mediaObjectKeySchema,
} from "./media-content.js";
import {
  MEDIA_IMAGE_PROFILE,
  mediaImageProcessingResultSchema,
  mediaProcessingEnqueueCommandSchema,
  mediaProcessingSnapshotSchema,
} from "./media-processing.js";
import { mediaPortResponseSchema } from "./media-port-contracts.js";
const version = schemaVersionSchema;
const uuid = z.uuid();
const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
// A reference to controlled evidence, never free-form rights text or a capability URL.
const evidenceReference = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u)
  .refine((v) => !v.includes("://") && !v.includes(".."));
const policyKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const policyKind = z.enum(["TERMS", "PRIVACY", "REFUND", "DELIVERY"]);
const dimension = z.number().int().positive().max(20_000);
const byteSize = z
  .number()
  .int()
  .positive()
  .max(MEDIA_IMAGE_PROFILE.sourceByteLimit);
const write = { idempotencyKey: idempotencyKeySchema, reasonCode };
const actor = { actorId: uuid, sessionId: uuid, requestId: uuid, reasonCode };
const source = z.strictObject({
  objectKey: mediaObjectKeySchema,
  checksumSha256: sourceHashSchema,
  byteSize,
  mimeType: mediaMimeTypeSchema,
});
export const mediaSourceInspectionCommandSchema = z.strictObject({
  schemaVersion: version,
  profileVersion: z.literal(1),
  source,
});
export const mediaSourceInspectionReceiptSchema = z
  .strictObject({
    schemaVersion: version,
    profileVersion: z.literal(1),
    source,
    width: dimension,
    height: dimension,
    orientation: z.number().int().min(1).max(8),
  })
  .refine((v) => v.width * v.height <= MEDIA_IMAGE_PROFILE.sourcePixelLimit);
export const mediaSourceInspectionResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    receipt: mediaSourceInspectionReceiptSchema,
  }),
  mediaImageProcessingResultSchema.options[1],
]);
export const adminResourcePermissionSchema = z.enum([
  "content.media.upload",
  "content.media.read",
  "content.media.process",
  "content.media.rights",
  "content.policy.manage",
]);
export const adminResourceAuthorizationCommandSchema = z.strictObject({
  schemaVersion: version,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  permission: adminResourcePermissionSchema,
});
const readPolicy = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_POLICY"),
  policyKey,
});
const registerPolicy = z.strictObject({
  schemaVersion: version,
  action: z.literal("REGISTER_POLICY"),
  policyKey,
  kind: policyKind,
  expectedVersion: z.literal(0),
  ...write,
});
const beginUpload = z.strictObject({
  schemaVersion: version,
  action: z.literal("BEGIN_UPLOAD"),
  checksumSha256: sourceHashSchema,
  byteSize,
  mimeType: mediaMimeTypeSchema,
  rightsReference: evidenceReference,
  expectedVersion: z.literal(0),
  ...write,
});
const readUpload = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_UPLOAD"),
  uploadId: uuid,
});
const completeUpload = z.strictObject({
  schemaVersion: version,
  action: z.literal("COMPLETE_UPLOAD"),
  uploadId: uuid,
  expectedVersion: z.literal(1),
  ...write,
});
const readMedia = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_MEDIA"),
  assetId: uuid,
});
const setRights = z.strictObject({
  schemaVersion: version,
  action: z.literal("SET_MEDIA_RIGHTS"),
  assetId: uuid,
  expectedVersion: sequence,
  rightsStatus: mediaAssetSchema.shape.rightsStatus,
  evidenceReference,
  ...write,
});
const enqueueMedia = z.strictObject({
  schemaVersion: version,
  action: z.literal("ENQUEUE_MEDIA"),
  sourceAssetId: uuid,
  metadataRevisionId: uuid,
  role: mediaProcessingEnqueueCommandSchema.shape.role,
  fit: mediaProcessingEnqueueCommandSchema.shape.fit,
  expectedVersion: z.literal(0),
  ...write,
});
const readJob = z.strictObject({
  schemaVersion: version,
  action: z.literal("READ_MEDIA_JOB"),
  jobId: uuid,
});
const retryJob = z.strictObject({
  schemaVersion: version,
  action: z.literal("RETRY_MEDIA_JOB"),
  jobId: uuid,
  expectedVersion: z.number().int().min(0).max(6),
  ...write,
});
export const adminResourceCommandSchema = z.discriminatedUnion("action", [
  readPolicy,
  registerPolicy,
  beginUpload,
  readUpload,
  completeUpload,
  readMedia,
  setRights,
  enqueueMedia,
  readJob,
  retryJob,
]);
export const adminResourceRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminResourceCommandSchema,
});
export const resourcePolicySnapshotSchema = z.strictObject({
  schemaVersion: version,
  policyKey,
  kind: policyKind,
  createdAt: contentTimestampSchema,
});
export const resourcePolicyResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("POLICY"),
    policy: resourcePolicySnapshotSchema,
  }),
  adminContentFailureSchema,
]);
export const mediaUploadTicketSchema = z
  .strictObject({
    schemaVersion: version,
    uploadId: uuid,
    version: z.union([z.literal(1), z.literal(2)]),
    actorId: uuid,
    sessionId: uuid,
    source,
    rightsReference: evidenceReference,
    status: z.enum(["PENDING", "REGISTERED"]),
    assetId: uuid.nullable(),
    createdAt: contentTimestampSchema,
    expiresAt: contentTimestampSchema,
  })
  .refine((v) =>
    v.status === "PENDING"
      ? v.version === 1 && v.assetId === null
      : v.version === 2 && v.assetId !== null,
  );
export const mediaUploadTicketResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    value: mediaUploadTicketSchema,
  }),
  adminContentFailureSchema,
]);
export const mediaUploadSnapshotSchema = z
  .strictObject({
    schemaVersion: version,
    uploadId: uuid,
    version: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["PENDING", "REGISTERED"]),
    assetId: uuid.nullable(),
    expiresAt: contentTimestampSchema,
  })
  .refine((v) =>
    v.status === "PENDING"
      ? v.version === 1 && v.assetId === null
      : v.version === 2 && v.assetId !== null,
  );
export const mediaUploadResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("UPLOAD"),
    upload: mediaUploadSnapshotSchema,
  }),
  adminContentFailureSchema,
]);
export const mediaUploadGrantResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("UPLOAD_GRANT"),
    uploadId: uuid,
    replayed: z.boolean(),
    grant: mediaPortResponseSchema.options[0].shape.value.pick({
      method: true,
      url: true,
      headers: true,
      expiresAt: true,
    }),
  }),
  adminContentFailureSchema,
]);
export const resourceMediaSnapshotSchema = z.strictObject({
  schemaVersion: version,
  assetId: uuid,
  identityKind: z.enum(["SOURCE", "PROCESSED_MASTER"]),
  mimeType: mediaMimeTypeSchema,
  width: dimension,
  height: dimension,
  byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  processingStatus: mediaAssetSchema.shape.processingStatus,
  rightsStatus: mediaAssetSchema.shape.rightsStatus,
  rightsVersion: sequence,
});
export const resourceMediaResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("MEDIA"),
    media: resourceMediaSnapshotSchema,
  }),
  adminContentFailureSchema,
]);
export const resourceMediaJobSnapshotSchema = z
  .strictObject({
    schemaVersion: version,
    snapshot: mediaProcessingSnapshotSchema,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    retryOfJobId: uuid.nullable(),
  })
  .refine((v) => (v.generation === 1) === (v.retryOfJobId === null));
export const resourceMediaJobResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("MEDIA_JOB"),
    job: resourceMediaJobSnapshotSchema,
  }),
  adminContentFailureSchema,
]);
export const adminResourceResponseSchema = z.union([
  adminMutationResponseSchema,
  resourcePolicyResponseSchema,
  mediaUploadResponseSchema,
  mediaUploadGrantResponseSchema,
  resourceMediaResponseSchema,
  resourceMediaJobResponseSchema,
]);
// Internal commands are constructed by Application after current authorization.
export const resourcePolicyReadCommandSchema = readPolicy.omit({
  action: true,
});
export const resourcePolicyRegisterCommandSchema = registerPolicy
  .omit({ action: true, idempotencyKey: true })
  .extend({ ...actor, receiptId: uuid });
export const mediaUploadReserveCommandSchema = beginUpload
  .omit({ action: true, idempotencyKey: true })
  .extend({
    ...actor,
    uploadId: uuid,
    objectKey: mediaObjectKeySchema,
    createdAt: contentTimestampSchema,
    expiresAt: contentTimestampSchema,
  });
export const mediaUploadReadCommandSchema = readUpload
  .omit({ action: true })
  .extend({ actorId: uuid, sessionId: uuid });
export const mediaUploadRegisterCommandSchema = completeUpload
  .omit({ action: true, idempotencyKey: true })
  .extend({
    ...actor,
    assetId: uuid,
    receipt: mediaSourceInspectionReceiptSchema,
  });
export const resourceMediaReadCommandSchema = readMedia.omit({ action: true });
export const mediaRightsSetCommandSchema = setRights
  .omit({ action: true, idempotencyKey: true })
  .extend({ ...actor, eventId: uuid });
export const resourceMediaEnqueueCommandSchema = enqueueMedia
  .omit({ action: true, idempotencyKey: true })
  .extend({ ...actor, jobId: uuid, receiptId: uuid });
export const resourceMediaJobReadCommandSchema = readJob.omit({ action: true });
export const resourceMediaRetryCommandSchema = retryJob
  .omit({ action: true, idempotencyKey: true })
  .extend({ ...actor, newJobId: uuid, receiptId: uuid });

export type MediaSourceInspectionCommand = z.infer<
  typeof mediaSourceInspectionCommandSchema
>;
export type MediaSourceInspectionReceipt = z.infer<
  typeof mediaSourceInspectionReceiptSchema
>;
export type MediaSourceInspectionResponse = z.infer<
  typeof mediaSourceInspectionResponseSchema
>;
export type AdminResourcePermission = z.infer<
  typeof adminResourcePermissionSchema
>;
export type AdminResourceAuthorizationCommand = z.infer<
  typeof adminResourceAuthorizationCommandSchema
>;
export type AdminResourceCommand = z.infer<typeof adminResourceCommandSchema>;
export type AdminResourceRequest = z.infer<typeof adminResourceRequestSchema>;
export type ResourcePolicySnapshot = z.infer<
  typeof resourcePolicySnapshotSchema
>;
export type ResourcePolicyResponse = z.infer<
  typeof resourcePolicyResponseSchema
>;
export type MediaUploadTicket = z.infer<typeof mediaUploadTicketSchema>;
export type MediaUploadTicketResponse = z.infer<
  typeof mediaUploadTicketResponseSchema
>;
export type MediaUploadSnapshot = z.infer<typeof mediaUploadSnapshotSchema>;
export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;
export type MediaUploadGrantResponse = z.infer<
  typeof mediaUploadGrantResponseSchema
>;
export type ResourceMediaSnapshot = z.infer<typeof resourceMediaSnapshotSchema>;
export type ResourceMediaResponse = z.infer<typeof resourceMediaResponseSchema>;
export type ResourceMediaJobSnapshot = z.infer<
  typeof resourceMediaJobSnapshotSchema
>;
export type ResourceMediaJobResponse = z.infer<
  typeof resourceMediaJobResponseSchema
>;
export type AdminResourceResponse = z.infer<typeof adminResourceResponseSchema>;
export type ResourcePolicyReadCommand = z.infer<
  typeof resourcePolicyReadCommandSchema
>;
export type ResourcePolicyRegisterCommand = z.infer<
  typeof resourcePolicyRegisterCommandSchema
>;
export type MediaUploadReserveCommand = z.infer<
  typeof mediaUploadReserveCommandSchema
>;
export type MediaUploadReadCommand = z.infer<
  typeof mediaUploadReadCommandSchema
>;
export type MediaUploadRegisterCommand = z.infer<
  typeof mediaUploadRegisterCommandSchema
>;
export type ResourceMediaReadCommand = z.infer<
  typeof resourceMediaReadCommandSchema
>;
export type MediaRightsSetCommand = z.infer<typeof mediaRightsSetCommandSchema>;
export type ResourceMediaEnqueueCommand = z.infer<
  typeof resourceMediaEnqueueCommandSchema
>;
export type ResourceMediaJobReadCommand = z.infer<
  typeof resourceMediaJobReadCommandSchema
>;
export type ResourceMediaRetryCommand = z.infer<
  typeof resourceMediaRetryCommandSchema
>;
