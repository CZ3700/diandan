import { z } from "zod";
import { adminOrdersAccessSchema } from "./admin-orders-persistence.js";
import { adminFinanceCommandSchema } from "./admin-finance.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  paymentPortResponseMatchesCommand,
} from "./payment-port-contracts.js";
import {
  orderPaymentApplyCommandSchema,
  orderPaymentListPendingCommandSchema,
  orderPaymentPendingEventsSchema,
  orderPaymentRunResultSchema,
} from "./order-payment-application.js";
const uuid = z.uuid();
const trace = { requestId: uuid, correlationId: uuid };
const lease = {
  leaseTokenDigest: sourceHashSchema,
  leaseDurationMs: z.number().int().min(1000).max(300000),
};
export const adminFinanceStoreRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    access: adminOrdersAccessSchema,
    command: adminFinanceCommandSchema,
    requestHash: sourceHashSchema.nullable(),
  })
  .refine((v) => !("idempotencyKey" in v.command) || v.requestHash !== null);
const providerCommands = paymentPortCommandSchema.options;
export const adminFinanceProviderCommandSchema = z.union([
  providerCommands[4],
  providerCommands[5],
  providerCommands[6],
  providerCommands[7],
]);
export const adminFinanceClaimRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...trace,
  ...lease,
  operationId: uuid.nullable(),
});
export const adminFinanceClaimSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    ...trace,
    operationId: uuid,
    orderId: uuid,
    refundId: uuid.nullable(),
    generation: checkoutVersionSchema,
    leaseTokenDigest: sourceHashSchema,
    leaseExpiresAt: contentTimestampSchema,
    adapterKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
    auditLogId: uuid.nullable(),
    command: adminFinanceProviderCommandSchema,
  })
  .refine((v) => {
    const c = v.command;
    return (
      ("refundId" in c ? c.refundId === v.refundId : v.refundId === null) &&
      ("auditLogId" in c
        ? c.auditLogId === v.auditLogId && v.auditLogId !== null
        : v.auditLogId === null)
    );
  }, "Claim must bind the exact refund and reconcile audit");
export const adminFinanceSettleCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    claim: adminFinanceClaimSchema,
    retryAfterMs: z.number().int().min(1000).max(86400000),
    result: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("PROVIDER_RESULT"),
        response: paymentPortResponseSchema,
      }),
      z.strictObject({
        kind: z.literal("UNCERTAIN"),
        reasonCode: z.enum([
          "PROVIDER_UNAVAILABLE",
          "PROVIDER_RESPONSE_INVALID",
          "PROVIDER_NETWORK_UNCERTAINTY",
        ]),
      }),
    ]),
  })
  .refine(
    (v) =>
      v.result.kind === "UNCERTAIN" ||
      paymentPortResponseMatchesCommand(v.claim.command, v.result.response),
    "Provider result must match its claim",
  );
export const adminFinanceSettleResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("SUCCESS"),
  operationId: uuid,
  decision: z.enum(["RECORDED", "STALE", "DEFERRED", "COMPLETE"]),
  providerEventId: uuid.nullable(),
});
export const adminFinanceApplyCommandSchema = orderPaymentApplyCommandSchema;
export const adminFinanceListPendingCommandSchema =
  orderPaymentListPendingCommandSchema;
export const adminFinancePendingEventsSchema = orderPaymentPendingEventsSchema;
export const adminFinanceRunResultSchema = orderPaymentRunResultSchema;
export const adminFinanceApplyResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerEventId: uuid,
  decision: z.enum([
    "APPLIED",
    "ALREADY_APPLIED",
    "UNMATCHED",
    "REVIEW",
    "IGNORED",
  ]),
  orderId: uuid.nullable(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
});
export type AdminFinanceStoreRequest = z.infer<
  typeof adminFinanceStoreRequestSchema
>;
export type AdminFinanceProviderCommand = z.infer<
  typeof adminFinanceProviderCommandSchema
>;
export type AdminFinanceClaimRequest = z.infer<
  typeof adminFinanceClaimRequestSchema
>;
export type AdminFinanceClaim = z.infer<typeof adminFinanceClaimSchema>;
export type AdminFinanceSettleCommand = z.infer<
  typeof adminFinanceSettleCommandSchema
>;
export type AdminFinanceSettleResult = z.infer<
  typeof adminFinanceSettleResultSchema
>;
export type AdminFinanceApplyCommand = z.infer<
  typeof adminFinanceApplyCommandSchema
>;
export type AdminFinanceApplyResult = z.infer<
  typeof adminFinanceApplyResultSchema
>;
export type AdminFinanceListPendingCommand = z.infer<
  typeof adminFinanceListPendingCommandSchema
>;
export type AdminFinancePendingEvents = z.infer<
  typeof adminFinancePendingEventsSchema
>;
export type AdminFinanceRunResult = z.infer<typeof adminFinanceRunResultSchema>;
