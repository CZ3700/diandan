import { z } from "zod";

import { idempotencyKeySchema } from "./identifiers.js";
import {
  portErrorBaseShape,
  portOpaqueReferenceSchema,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import { schemaVersionSchema } from "./versioning.js";

export const cachePurgePortOperationSchema = z.enum([
  "SUBMIT_PURGE",
  "GET_PURGE_STATUS",
]);
export const cachePurgeStatusSchema = z.enum(["PENDING", "COMPLETED"]);
export const cachePurgePortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "PURGE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const cachePurgePortErrorSchema = z
  .strictObject({ ...portErrorBaseShape, code: cachePurgePortErrorCodeSchema })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
    }),
  );

export const cachePurgePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(
    /^\/(?!.*(?:\?|#|\.\.|~))(?:[A-Za-z0-9._!$&'()+,;=:@/-]|%[0-9A-Fa-f]{2})*\*?$/u,
  )
  .refine((path) => !/%7e/iu.test(path), {
    message: "CloudFront invalidation paths do not support tilde",
  });

const submitCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("SUBMIT_PURGE"),
  idempotencyKey: idempotencyKeySchema,
  paths: z.array(cachePurgePathSchema).min(1).max(3_000),
});
const statusCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_PURGE_STATUS"),
  purgeReference: portOpaqueReferenceSchema,
});
export const cachePurgePortCommandSchema = z.discriminatedUnion("operation", [
  submitCommandSchema,
  statusCommandSchema,
]);

const failureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: cachePurgePortOperationSchema,
  outcome: z.literal("FAILURE"),
  error: cachePurgePortErrorSchema,
});
const submitSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("SUBMIT_PURGE"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    purgeReference: portOpaqueReferenceSchema,
    status: cachePurgeStatusSchema,
    submittedAt: portTimestampSchema,
  }),
});
const statusSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_PURGE_STATUS"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    purgeReference: portOpaqueReferenceSchema,
    status: cachePurgeStatusSchema,
    completedAt: portTimestampSchema.optional(),
  }),
});
export const cachePurgePortResponseSchema = z.union([
  submitSuccessSchema,
  statusSuccessSchema,
  failureSchema,
]);

export type CachePurgePortCommand = z.infer<typeof cachePurgePortCommandSchema>;
export type CachePurgePortResponse = z.infer<
  typeof cachePurgePortResponseSchema
>;
export type CachePurgePortError = z.infer<typeof cachePurgePortErrorSchema>;
export type CachePurgePortFailure = z.infer<typeof failureSchema>;
type CachePurgeFailureFor<
  Operation extends CachePurgePortCommand["operation"],
> = Omit<CachePurgePortFailure, "operation"> &
  Readonly<{ operation: Operation }>;
export type SubmitCachePurgeCommand = z.infer<typeof submitCommandSchema>;
export type SubmitCachePurgeResponse =
  | Extract<CachePurgePortResponse, { operation: "SUBMIT_PURGE" }>
  | CachePurgeFailureFor<"SUBMIT_PURGE">;
export type GetCachePurgeStatusCommand = z.infer<typeof statusCommandSchema>;
export type GetCachePurgeStatusResponse =
  | Extract<CachePurgePortResponse, { operation: "GET_PURGE_STATUS" }>
  | CachePurgeFailureFor<"GET_PURGE_STATUS">;
