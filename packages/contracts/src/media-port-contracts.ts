import { z } from "zod";

import { sourceHashSchema } from "./content-lifecycle.js";
import { mediaMimeTypeSchema, mediaObjectKeySchema } from "./media-content.js";
import {
  containsC0OrDelControlCharacter,
  portErrorBaseShape,
  portOpaqueReferenceSchema,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import {
  credentiallessHttpsUrlSchema,
  publicMediaUrlSchema,
} from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const mediaStorageClassSchema = z.enum(["SOURCE", "DERIVATIVE"]);
export const mediaObjectRevisionTokenSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const mediaPortOperationSchema = z.enum([
  "CREATE_UPLOAD_GRANT",
  "INSPECT_OBJECT",
  "CREATE_DOWNLOAD_GRANT",
  "DELETE_OBJECT",
  "RESOLVE_PUBLIC_URL",
]);
export const mediaPortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "OBJECT_NOT_FOUND",
  "OBJECT_ALREADY_EXISTS",
  "PRECONDITION_FAILED",
  "CHECKSUM_MISMATCH",
  "CONTENT_MISMATCH",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const mediaPortErrorSchema = z
  .strictObject({ ...portErrorBaseShape, code: mediaPortErrorCodeSchema })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
    }),
  );

const byteSizeSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const headerMapSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u),
    z
      .string()
      .max(4_096)
      .refine((value) => !containsC0OrDelControlCharacter(value), {
        message: "media grant headers must not contain control characters",
      }),
  )
  .superRefine((headers, context) => {
    const entries = Object.entries(headers);
    if (entries.length > 32) {
      context.addIssue({
        code: "custom",
        message: "media grant headers must contain at most 32 fields",
      });
    }
    const encoder = new TextEncoder();
    const encodedBytes = entries.reduce(
      (total, [name, value]) =>
        total +
        encoder.encode(name).byteLength +
        encoder.encode(value).byteLength +
        4,
      0,
    );
    if (encodedBytes > 16_384) {
      context.addIssue({
        code: "custom",
        message: "media grant headers must not exceed 16 KiB",
      });
    }
  });
const mediaObjectIdentityShape = {
  storageClass: mediaStorageClassSchema,
  objectKey: mediaObjectKeySchema,
} as const;

const createUploadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_UPLOAD_GRANT"),
  ...mediaObjectIdentityShape,
  checksumSha256: sourceHashSchema,
  byteSize: byteSizeSchema,
  mimeType: mediaMimeTypeSchema,
  expiresAt: portTimestampSchema,
});
const inspectCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("INSPECT_OBJECT"),
  ...mediaObjectIdentityShape,
});
const createDownloadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_DOWNLOAD_GRANT"),
  ...mediaObjectIdentityShape,
  expiresAt: portTimestampSchema,
});
const deleteCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("DELETE_OBJECT"),
  ...mediaObjectIdentityShape,
  expectedChecksumSha256: sourceHashSchema,
  expectedRevisionToken: mediaObjectRevisionTokenSchema,
  expectedVersionId: portOpaqueReferenceSchema.optional(),
});
const resolvePublicUrlCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RESOLVE_PUBLIC_URL"),
  storageClass: z.literal("DERIVATIVE"),
  objectKey: mediaObjectKeySchema,
});

export const mediaPortCommandSchema = z.discriminatedUnion("operation", [
  createUploadCommandSchema,
  inspectCommandSchema,
  createDownloadCommandSchema,
  deleteCommandSchema,
  resolvePublicUrlCommandSchema,
]);

const failureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: mediaPortOperationSchema,
  outcome: z.literal("FAILURE"),
  error: mediaPortErrorSchema,
});
const uploadSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_UPLOAD_GRANT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    ...mediaObjectIdentityShape,
    checksumSha256: sourceHashSchema,
    byteSize: byteSizeSchema,
    mimeType: mediaMimeTypeSchema,
    method: z.literal("PUT"),
    url: credentiallessHttpsUrlSchema,
    headers: headerMapSchema,
    expiresAt: portTimestampSchema,
  }),
});
const inspectSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("INSPECT_OBJECT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    ...mediaObjectIdentityShape,
    checksumSha256: sourceHashSchema,
    byteSize: byteSizeSchema,
    mimeType: mediaMimeTypeSchema,
    revisionToken: mediaObjectRevisionTokenSchema,
    versionId: portOpaqueReferenceSchema.optional(),
  }),
});
const downloadSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_DOWNLOAD_GRANT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    ...mediaObjectIdentityShape,
    method: z.literal("GET"),
    url: credentiallessHttpsUrlSchema,
    headers: headerMapSchema,
    expiresAt: portTimestampSchema,
  }),
});
const deleteSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("DELETE_OBJECT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    ...mediaObjectIdentityShape,
    checksumSha256: sourceHashSchema,
    revisionToken: mediaObjectRevisionTokenSchema,
    versionId: portOpaqueReferenceSchema.optional(),
    deleted: z.literal(true),
  }),
});
const publicUrlSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RESOLVE_PUBLIC_URL"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    storageClass: z.literal("DERIVATIVE"),
    objectKey: mediaObjectKeySchema,
    url: publicMediaUrlSchema,
  }),
});

export const mediaPortResponseSchema = z.union([
  uploadSuccessSchema,
  inspectSuccessSchema,
  downloadSuccessSchema,
  deleteSuccessSchema,
  publicUrlSuccessSchema,
  failureSchema,
]);

export type MediaPortCommand = z.infer<typeof mediaPortCommandSchema>;
export type MediaPortResponse = z.infer<typeof mediaPortResponseSchema>;
export type MediaPortError = z.infer<typeof mediaPortErrorSchema>;
export type MediaPortFailure = z.infer<typeof failureSchema>;
type MediaFailureFor<Operation extends MediaPortCommand["operation"]> = Omit<
  MediaPortFailure,
  "operation"
> &
  Readonly<{ operation: Operation }>;
export type CreateMediaUploadGrantCommand = z.infer<
  typeof createUploadCommandSchema
>;
export type CreateMediaUploadGrantResponse =
  | Extract<MediaPortResponse, { operation: "CREATE_UPLOAD_GRANT" }>
  | MediaFailureFor<"CREATE_UPLOAD_GRANT">;
export type InspectMediaObjectCommand = z.infer<typeof inspectCommandSchema>;
export type InspectMediaObjectResponse =
  | Extract<MediaPortResponse, { operation: "INSPECT_OBJECT" }>
  | MediaFailureFor<"INSPECT_OBJECT">;
export type CreateMediaDownloadGrantCommand = z.infer<
  typeof createDownloadCommandSchema
>;
export type CreateMediaDownloadGrantResponse =
  | Extract<MediaPortResponse, { operation: "CREATE_DOWNLOAD_GRANT" }>
  | MediaFailureFor<"CREATE_DOWNLOAD_GRANT">;
export type DeleteMediaObjectCommand = z.infer<typeof deleteCommandSchema>;
export type DeleteMediaObjectResponse =
  | Extract<MediaPortResponse, { operation: "DELETE_OBJECT" }>
  | MediaFailureFor<"DELETE_OBJECT">;
export type ResolvePublicMediaUrlCommand = z.infer<
  typeof resolvePublicUrlCommandSchema
>;
export type ResolvePublicMediaUrlResponse =
  | Extract<MediaPortResponse, { operation: "RESOLVE_PUBLIC_URL" }>
  | MediaFailureFor<"RESOLVE_PUBLIC_URL">;
