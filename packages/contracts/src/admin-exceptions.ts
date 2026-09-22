import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { idempotencyKeySchema, publicOrderIdSchema } from "./identifiers.js";
import { reliableEventConsumerKeySchema } from "./reliable-events.js";

const uuid = z.uuid().toLowerCase();
const version = z.literal(1);
const targetFor = <K extends "WEBHOOK" | "PAYMENT" | "NOTIFICATION">(kind: K) =>
  z.strictObject({ kind: z.literal(kind), id: uuid, consumerKey: z.null() });
const webhook = targetFor("WEBHOOK"),
  payment = targetFor("PAYMENT"),
  notification = targetFor("NOTIFICATION");
const deadLetter = z.strictObject({
  kind: z.literal("DEAD_LETTER"),
  id: uuid,
  consumerKey: reliableEventConsumerKeySchema,
});
export const adminExceptionTargetSchema = z.discriminatedUnion("kind", [
  webhook,
  deadLetter,
  payment,
  notification,
]);
export const adminExceptionActionSchema = z.enum([
  "REPLAY_WEBHOOK",
  "RETRY_DEAD_LETTER",
  "RECONCILE_PAYMENT",
  "RETRY_NOTIFICATION",
]);
export const adminExceptionReasonSchema = z.enum([
  "RETRY_AFTER_REPAIR",
  "VERIFY_PROVIDER_STATUS",
  "RETRY_FAILED_NOTIFICATION",
  "OPERATOR_REVIEW",
]);
export const adminExceptionBlockReasonSchema = z.enum([
  "NONE",
  "READ_ONLY",
  "IN_PROGRESS",
  "ALREADY_COMPLETE",
  "MANUAL_REVIEW_REQUIRED",
  "UNSUPPORTED_CONSUMER",
  "NOTIFICATION_UNCERTAIN",
  "NOTIFICATION_EXPIRED",
  "NOTIFICATION_SUPERSEDED",
  "NOT_RETRYABLE",
  "SOURCE_INCONSISTENT",
]);
export const adminExceptionStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "FAILED",
  "UNKNOWN",
  "SUCCEEDED",
  "REVIEW",
  "EXPIRED",
]);
const pagination = {
  page: z.number().int().min(1).max(10000),
  pageSize: z.number().int().min(1).max(50),
};
const mutation = {
  schemaVersion: version,
  expectedVersion: sourceHashSchema,
  idempotencyKey: idempotencyKeySchema,
  reasonCode: adminExceptionReasonSchema,
  confirmed: z.literal(true),
};
export const adminExceptionsCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: version, action: z.literal("CONTEXT") }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("LIST"),
    ...pagination,
    category: z.enum([
      "ALL",
      "WEBHOOK",
      "DEAD_LETTER",
      "PAYMENT",
      "NOTIFICATION",
    ]),
    status: z.enum(["OPEN", "ALL"]),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("DETAIL"),
    target: adminExceptionTargetSchema,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("REPLAY_WEBHOOK"),
    target: webhook,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("RETRY_DEAD_LETTER"),
    target: deadLetter,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("RECONCILE_PAYMENT"),
    target: payment,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("RETRY_NOTIFICATION"),
    target: notification,
  }),
]);
export const adminExceptionsRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminExceptionsCommandSchema,
});
export const adminExceptionsFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "STALE_VERSION",
    "IDEMPOTENCY_CONFLICT",
    "CONFLICT",
    "TRANSITION_NOT_ALLOWED",
    "SOURCE_IN_PROGRESS",
    "UNSUPPORTED_CONSUMER",
    "RECONCILIATION_REQUIRED",
    "NOTIFICATION_NOT_READY",
    "NOTIFICATION_IN_PROGRESS",
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});
export const adminExceptionItemSchema = z
  .strictObject({
    target: adminExceptionTargetSchema,
    version: sourceHashSchema,
    orderId: uuid.nullable(),
    publicOrderId: publicOrderIdSchema.nullable(),
    status: adminExceptionStatusSchema,
    attemptCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAt: contentTimestampSchema,
    allowedAction: adminExceptionActionSchema.nullable(),
    blockedReason: adminExceptionBlockReasonSchema,
  })
  .refine(
    (v) => (v.allowedAction !== null) === (v.blockedReason === "NONE"),
    "Action availability must explain its restriction",
  )
  .refine(
    (v) =>
      v.allowedAction === null ||
      {
        WEBHOOK: "REPLAY_WEBHOOK",
        DEAD_LETTER: "RETRY_DEAD_LETTER",
        PAYMENT: "RECONCILE_PAYMENT",
        NOTIFICATION: "RETRY_NOTIFICATION",
      }[v.target.kind] === v.allowedAction,
    "Action must match its source",
  );
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const adminExceptionsResponseSchema = z.union([
  adminExceptionsFailureSchema,
  z.strictObject({
    ...success,
    kind: z.literal("CONTEXT"),
    actorId: uuid,
    permissions: z.strictObject({
      canRead: z.boolean(),
      canReplayWebhook: z.boolean(),
      canRetryDeadLetter: z.boolean(),
      canReconcilePayment: z.boolean(),
      canRetryNotification: z.boolean(),
    }),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("LIST"),
    ...pagination,
    totalItems: z.number().int().nonnegative(),
    items: z.array(adminExceptionItemSchema).max(50),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("DETAIL"),
    item: adminExceptionItemSchema,
    operations: z
      .array(
        z.strictObject({
          operationId: uuid,
          action: adminExceptionActionSchema,
          status: z.enum(["REQUESTED", "PROCESSING", "SUCCEEDED", "FAILED"]),
          createdAt: contentTimestampSchema,
        }),
      )
      .max(20),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("MUTATION"),
    action: adminExceptionActionSchema,
    target: adminExceptionTargetSchema,
    operationId: uuid,
    replayed: z.boolean(),
  }),
]);
export type AdminExceptionTarget = z.infer<typeof adminExceptionTargetSchema>;
export type AdminExceptionAction = z.infer<typeof adminExceptionActionSchema>;
export type AdminExceptionItem = z.infer<typeof adminExceptionItemSchema>;
export type AdminExceptionsCommand = z.infer<
  typeof adminExceptionsCommandSchema
>;
export type AdminExceptionsRequest = z.infer<
  typeof adminExceptionsRequestSchema
>;
export type AdminExceptionsResponse = z.infer<
  typeof adminExceptionsResponseSchema
>;
export type AdminExceptionsFailure = z.infer<
  typeof adminExceptionsFailureSchema
>;

export function adminExceptionTargetsEqual(
  a: AdminExceptionTarget,
  b: AdminExceptionTarget,
): boolean {
  return a.kind === b.kind && a.id === b.id && a.consumerKey === b.consumerKey;
}
/** A schema-valid receipt for a different command must never clear an uncertain request. */
export function adminExceptionsResponseMatches(
  command: AdminExceptionsCommand,
  input: unknown,
): boolean {
  const parsed = adminExceptionsResponseSchema.safeParse(input);
  if (!parsed.success) return false;
  const response = parsed.data;
  if (response.outcome === "FAILURE") return true;
  switch (command.action) {
    case "CONTEXT":
      return response.kind === "CONTEXT";
    case "LIST":
      return (
        response.kind === "LIST" &&
        response.page === command.page &&
        response.pageSize === command.pageSize &&
        response.items.length <= command.pageSize &&
        response.items.every(
          (item) =>
            (command.category === "ALL" ||
              item.target.kind === command.category) &&
            (command.status === "ALL" || item.status !== "SUCCEEDED"),
        )
      );
    case "DETAIL":
      return (
        response.kind === "DETAIL" &&
        adminExceptionTargetsEqual(command.target, response.item.target)
      );
    default:
      return (
        response.kind === "MUTATION" &&
        response.action === command.action &&
        adminExceptionTargetsEqual(command.target, response.target)
      );
  }
}
