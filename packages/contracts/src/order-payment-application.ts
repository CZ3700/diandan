import { z } from "zod";
import { canonicalRequestIdSchema } from "./envelopes.js";
import {
  orderIdSchema,
  paymentAttemptIdSchema,
  providerEventIdSchema,
} from "./identifiers.js";
import { schemaVersionSchema } from "./versioning.js";

/** Internal durable reference only. The repository re-reads all financial facts. */
export const orderPaymentApplyCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  providerEventId: providerEventIdSchema,
  requestId: canonicalRequestIdSchema,
  correlationId: canonicalRequestIdSchema,
  taskName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u),
});
const receiptShape = {
  schemaVersion: schemaVersionSchema,
  receiptId: z.uuid(),
  providerEventId: providerEventIdSchema,
};
export const orderPaymentApplyResultSchema = z
  .discriminatedUnion("decision", [
    z.strictObject({
      ...receiptShape,
      decision: z.literal("APPLIED"),
      attemptId: paymentAttemptIdSchema,
      orderId: orderIdSchema,
      outcome: z.enum(["PAID", "PAID_REVIEW", "FAILED_RELEASED"]),
    }),
    z.strictObject({
      ...receiptShape,
      decision: z.literal("ALREADY_APPLIED"),
      attemptId: paymentAttemptIdSchema,
      orderId: orderIdSchema,
      outcome: z.enum(["PAID", "PAID_REVIEW", "FAILED_RELEASED"]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("UNMATCHED"),
      providerEventId: providerEventIdSchema,
      reason: z.literal("EXTERNAL_REFERENCE_NOT_BOUND"),
    }),
    z.strictObject({
      ...receiptShape,
      decision: z.literal("REVIEW"),
      attemptId: paymentAttemptIdSchema.nullable(),
      orderId: orderIdSchema.nullable(),
      reasonCode: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Z][A-Z0-9_]*$/u),
    }),
    z.strictObject({
      ...receiptShape,
      decision: z.literal("IGNORED"),
      attemptId: paymentAttemptIdSchema.nullable(),
      orderId: orderIdSchema.nullable(),
      reasonCode: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Z][A-Z0-9_]*$/u),
    }),
  ])
  .refine(
    (value) =>
      !("attemptId" in value) ||
      (value.attemptId === null) === (value.orderId === null),
    { message: "attempt and order references must be bound together" },
  );
export const orderPaymentListPendingCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  limit: z.number().int().min(1).max(100),
});
export const orderPaymentPendingEventsSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    providerEventIds: z.array(providerEventIdSchema).max(100),
  })
  .refine(
    (value) =>
      new Set(value.providerEventIds.map((id) => id.toLowerCase())).size ===
      value.providerEventIds.length,
    { message: "duplicate pending payment evidence" },
  );

const batchCount = z.number().int().min(0).max(100);
export const orderPaymentRunResultSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    scanned: batchCount,
    applied: batchCount,
    replayed: batchCount,
    unmatched: batchCount,
    review: batchCount,
    ignored: batchCount,
    failed: batchCount,
  })
  .refine(
    (value) =>
      value.scanned ===
      value.applied +
        value.replayed +
        value.unmatched +
        value.review +
        value.ignored +
        value.failed,
    { message: "each scanned event must have one outcome" },
  );

export type OrderPaymentApplyCommand = z.infer<
  typeof orderPaymentApplyCommandSchema
>;
export type OrderPaymentApplyResult = z.infer<
  typeof orderPaymentApplyResultSchema
>;
export type OrderPaymentListPendingCommand = z.infer<
  typeof orderPaymentListPendingCommandSchema
>;
export type OrderPaymentPendingEvents = z.infer<
  typeof orderPaymentPendingEventsSchema
>;
export type OrderPaymentRunResult = z.infer<typeof orderPaymentRunResultSchema>;
