import { z } from "zod";
import { currencySchema, minorAmountSchema } from "./commerce.js";
import {
  providerEventSchema,
  paymentEnvironmentSchema,
  refundStatusSchema,
} from "./payment.js";
import { disputeStatusSchema } from "./order.js";
import {
  externalPaymentReferenceSchema,
  providerRefundReferenceSchema,
} from "./identifiers.js";
const identity = z.strictObject({
  paymentAttemptId: z.uuid(),
  providerAccountId: z.uuid(),
  environment: paymentEnvironmentSchema,
  externalReference: externalPaymentReferenceSchema,
  providerReference: providerRefundReferenceSchema,
  amountMinor: minorAmountSchema.min(1),
  capturedAmountMinor: minorAmountSchema.min(1),
  currency: currencySchema,
});
/** Internal trusted-ingress input: parsing does not authenticate a provider. The repository must independently verify persisted webhook/reconcile authority. */
export const financeEvidenceInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("REFUND"),
    currentStatus: refundStatusSchema,
    target: identity,
    event: providerEventSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("DISPUTE"),
    currentStatus: disputeStatusSchema,
    target: identity,
    event: providerEventSchema,
  }),
]);
export const financeEvidenceDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    decision: z.enum(["APPLY", "IGNORE", "REVIEW", "WAIT"]),
    targetStatus: z.union([refundStatusSchema, disputeStatusSchema]).nullable(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  })
  .refine((v) => (v.decision === "APPLY") === (v.targetStatus !== null));
export const financeDisputeProjectionInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  statuses: z.array(z.enum(["OPEN", "WON", "LOST"])),
});
export const financeDisputeProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: disputeStatusSchema,
});
export type FinanceEvidenceInput = z.infer<typeof financeEvidenceInputSchema>;
export type FinanceEvidenceDecision = z.infer<
  typeof financeEvidenceDecisionSchema
>;
export type FinanceDisputeProjection = z.infer<
  typeof financeDisputeProjectionSchema
>;
