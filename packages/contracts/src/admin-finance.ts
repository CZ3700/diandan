import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import { currencySchema, minorAmountSchema } from "./commerce.js";
import {
  idempotencyKeySchema,
  publicOrderIdSchema,
  publicOrderNoSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { orderStatusSchema, disputeStatusSchema } from "./order.js";
import {
  paymentAttemptStatusSchema,
  orderPaymentStatusSchema,
  refundStatusSchema,
} from "./payment.js";
const uuid = z.uuid();
const version = z.literal(1);
const positiveAmount = minorAmountSchema.min(1);
const mutation = {
  orderId: uuid,
  expectedOrderVersion: checkoutVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  confirmed: z.literal(true),
};
const pagination = {
  page: z.number().int().min(1).max(10000),
  pageSize: z.number().int().min(1).max(50),
};
export const adminFinanceAllocationSchema = z.strictObject({
  orderItemId: uuid,
  amountMinor: positiveAmount,
});
export const adminFinanceCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: version,
    action: z.literal("LIST"),
    ...pagination,
    query: z.string().trim().max(80),
    filter: z.enum(["ALL", "NEEDS_RECONCILIATION", "REFUNDS", "DISPUTES"]),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("DETAIL"),
    orderId: uuid,
  }),
  z
    .strictObject({
      schemaVersion: version,
      action: z.literal("REFUND"),
      ...mutation,
      currency: currencySchema,
      amountMinor: positiveAmount,
      allocations: z.array(adminFinanceAllocationSchema).min(1).max(500),
    })
    .superRefine((value, ctx) => {
      if (
        new Set(value.allocations.map((a) => a.orderItemId.toLowerCase()))
          .size !== value.allocations.length ||
        value.allocations.reduce(
          (sum, a) => sum + BigInt(a.amountMinor),
          0n,
        ) !== BigInt(value.amountMinor)
      )
        ctx.addIssue({
          code: "custom",
          message: "Unique item allocations must equal requested amount",
          path: ["allocations"],
        });
    }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("CANCEL"),
    ...mutation,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("RECONCILE"),
    ...mutation,
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("PAYMENT"), attemptId: uuid }),
      z.strictObject({ kind: z.literal("REFUND"), refundId: uuid }),
    ]),
  }),
]);
export const adminFinanceRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminFinanceCommandSchema,
});
export const adminFinanceFailureSchema = z.strictObject({
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
    "PAYMENT_NOT_CONFIRMED",
    "DISPUTE_REQUIRES_REVIEW",
    "REFUND_CAPACITY_EXCEEDED",
    "REFUND_ITEM_CAPACITY_EXCEEDED",
    "CURRENCY_MISMATCH",
    "TRANSITION_NOT_ALLOWED",
    "RECONCILIATION_REQUIRED",
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});
export const adminFinanceOrderSummarySchema = z.strictObject({
  orderId: uuid,
  publicOrderId: publicOrderIdSchema,
  publicOrderNo: publicOrderNoSchema,
  version: checkoutVersionSchema,
  presentationLocale: supportedLocaleSchema,
  orderStatus: orderStatusSchema,
  paymentStatus: orderPaymentStatusSchema,
  disputeStatus: disputeStatusSchema,
  currency: currencySchema,
  totalAmountMinor: minorAmountSchema,
  capturedAmountMinor: minorAmountSchema,
  occupiedRefundAmountMinor: minorAmountSchema,
  refundedAmountMinor: minorAmountSchema,
  availableRefundAmountMinor: minorAmountSchema,
  needsReconciliation: z.boolean(),
  updatedAt: contentTimestampSchema,
});
export const adminFinanceRefundViewSchema = z.strictObject({
  refundId: uuid,
  version: checkoutVersionSchema,
  status: refundStatusSchema,
  amountMinor: positiveAmount,
  processedAmountMinor: minorAmountSchema,
  allocations: z.array(adminFinanceAllocationSchema).min(1).max(500),
  canReconcile: z.boolean(),
  createdAt: contentTimestampSchema,
  updatedAt: contentTimestampSchema,
});
export const adminFinanceAttemptViewSchema = z.strictObject({
  attemptId: uuid,
  status: paymentAttemptStatusSchema,
  amountMinor: minorAmountSchema,
  canReconcile: z.boolean(),
});
export const adminFinanceDisputeViewSchema = z.strictObject({
  disputeId: uuid,
  status: z.enum(["OPEN", "WON", "LOST"]),
  amountMinor: minorAmountSchema,
  updatedAt: contentTimestampSchema,
});
export const adminFinanceIssueViewSchema = z.strictObject({
  issueId: uuid,
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  createdAt: contentTimestampSchema,
});
export const adminFinanceMutationResponseSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("SUCCESS"),
  kind: z.literal("MUTATION"),
  orderId: uuid,
  operationId: uuid,
  refundId: uuid.nullable(),
  replayed: z.boolean(),
});
export const adminFinanceResponseSchema = z.union([
  adminFinanceFailureSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("LIST"),
    ...pagination,
    totalItems: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    canManage: z.boolean(),
    items: z.array(adminFinanceOrderSummarySchema).max(50),
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("DETAIL"),
    order: adminFinanceOrderSummarySchema,
    canManage: z.boolean(),
    canCancel: z.boolean(),
    items: z
      .array(
        z.strictObject({
          orderItemId: uuid,
          position: z.number().int().min(1).max(500),
          amountMinor: minorAmountSchema,
          occupiedAmountMinor: minorAmountSchema,
          availableAmountMinor: minorAmountSchema,
        }),
      )
      .min(1)
      .max(500),
    attempts: z.array(adminFinanceAttemptViewSchema).max(500),
    refunds: z.array(adminFinanceRefundViewSchema).max(500),
    disputes: z.array(adminFinanceDisputeViewSchema).max(500),
    issues: z.array(adminFinanceIssueViewSchema).max(100),
  }),
  adminFinanceMutationResponseSchema,
]);
export type AdminFinanceCommand = z.infer<typeof adminFinanceCommandSchema>;
export type AdminFinanceRequest = z.infer<typeof adminFinanceRequestSchema>;
export type AdminFinanceFailure = z.infer<typeof adminFinanceFailureSchema>;
export type AdminFinanceResponse = z.infer<typeof adminFinanceResponseSchema>;
export type AdminFinanceMutationResponse = z.infer<
  typeof adminFinanceMutationResponseSchema
>;
export type AdminFinanceOrderSummary = z.infer<
  typeof adminFinanceOrderSummarySchema
>;
export type AdminFinanceRefundView = z.infer<
  typeof adminFinanceRefundViewSchema
>;
export type AdminFinanceAllocation = z.infer<
  typeof adminFinanceAllocationSchema
>;
