import { z } from "zod";
import { adminOrdersAccessSchema } from "./admin-orders-persistence.js";
import {
  adminExceptionsCommandSchema,
  adminExceptionTargetSchema,
} from "./admin-exceptions.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { reliableEventJobSchema } from "./reliable-events.js";
const uuid = z.uuid().toLowerCase();
export const adminExceptionsStoreRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    access: adminOrdersAccessSchema,
    command: adminExceptionsCommandSchema,
    requestHash: sourceHashSchema.nullable(),
  })
  .refine((v) => !("idempotencyKey" in v.command) || v.requestHash !== null);
export const adminExceptionsClaimRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: uuid,
  correlationId: uuid,
  operationId: uuid.nullable(),
  leaseTokenDigest: sourceHashSchema,
  leaseDurationMs: z.number().int().min(1000).max(300000),
});
export const adminExceptionsClaimSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: uuid,
    action: z.enum(["REPLAY_WEBHOOK", "RETRY_DEAD_LETTER"]),
    target: adminExceptionTargetSchema,
    generation: z.number().int().positive(),
    leaseTokenDigest: sourceHashSchema,
    leaseExpiresAt: contentTimestampSchema,
    job: reliableEventJobSchema,
  })
  .refine(
    (v) =>
      v.action === "REPLAY_WEBHOOK"
        ? v.target.kind === "WEBHOOK" &&
          v.job.jobType === "PROCESS_WEBHOOK_INBOX" &&
          v.job.webhookInboxId === v.target.id
        : v.target.kind === "DEAD_LETTER" &&
          v.job.jobType === "DISPATCH_OUTBOX_EVENT" &&
          v.job.outboxEventId === v.target.id &&
          v.job.consumerKey === v.target.consumerKey,
    "Recovery must preserve the original source and consumer",
  );
export const adminExceptionsSettleCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    claim: adminExceptionsClaimSchema,
    outcome: z.enum(["SUCCEEDED", "FAILED"]),
    reasonCode: z.enum(["PROCESSED", "PROCESSING_FAILED"]),
  })
  .refine(
    (v) => (v.outcome === "SUCCEEDED") === (v.reasonCode === "PROCESSED"),
  );
export const adminExceptionsSettleResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: uuid,
  decision: z.enum(["RECORDED", "STALE"]),
});
const batchCount = z.number().int().min(0).max(100);
export const adminExceptionsRunResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    scanned: batchCount,
    succeeded: batchCount,
    failed: batchCount,
  })
  .refine((value) => value.scanned === value.succeeded + value.failed);
export type AdminExceptionsStoreRequest = z.infer<
  typeof adminExceptionsStoreRequestSchema
>;
export type AdminExceptionsClaimRequest = z.infer<
  typeof adminExceptionsClaimRequestSchema
>;
export type AdminExceptionsClaim = z.infer<typeof adminExceptionsClaimSchema>;
export type AdminExceptionsSettleCommand = z.infer<
  typeof adminExceptionsSettleCommandSchema
>;
export type AdminExceptionsSettleResult = z.infer<
  typeof adminExceptionsSettleResultSchema
>;
export type AdminExceptionsRunResult = z.infer<
  typeof adminExceptionsRunResultSchema
>;
