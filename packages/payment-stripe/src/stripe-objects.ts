import { z } from "zod";

import { isStripeId, type StripeObjectKind } from "./references.js";

// Stripe adds fields over time, so objects are parsed loosely; every field we act on is strict.
const stripeId = (kind: StripeObjectKind) =>
  z.string().refine((value) => isStripeId(value, kind));
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[a-z]{3}$/u);
const metadata = z.record(z.string(), z.string()).nullable().optional();

export const stripePaymentIntentSchema = z.object({
  id: stripeId("paymentIntent"),
  object: z.literal("payment_intent"),
  status: z.enum([
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
    "requires_capture",
    "canceled",
    "succeeded",
  ]),
  amount,
  currency,
  latest_charge: z
    .union([stripeId("charge"), z.object({ id: stripeId("charge") })])
    .nullable()
    .optional(),
  metadata,
  livemode: z.boolean(),
});
export type StripePaymentIntent = z.infer<typeof stripePaymentIntentSchema>;

export const stripeSessionSchema = z.object({
  id: stripeId("session"),
  object: z.literal("checkout.session"),
  mode: z.literal("payment"),
  status: z.enum(["open", "complete", "expired"]),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  url: z.string().nullable().optional(),
  payment_intent: z
    .union([stripeId("paymentIntent"), stripePaymentIntentSchema])
    .nullable(),
  amount_total: amount.nullable(),
  currency: currency.nullable(),
  client_reference_id: z.string().nullable(),
  locale: z.string().max(35).nullable().optional(),
  metadata,
  livemode: z.boolean(),
  created: z.number().int(),
});
export type StripeSession = z.infer<typeof stripeSessionSchema>;

export const stripeRefundSchema = z.object({
  id: stripeId("refund"),
  object: z.literal("refund"),
  amount,
  currency,
  status: z.enum([
    "pending",
    "requires_action",
    "succeeded",
    "failed",
    "canceled",
  ]),
  payment_intent: stripeId("paymentIntent").nullable(),
  metadata,
  created: z.number().int(),
});
export type StripeRefund = z.infer<typeof stripeRefundSchema>;

export const stripeDisputeSchema = z.object({
  id: stripeId("dispute"),
  object: z.literal("dispute"),
  amount,
  currency,
  status: z.enum([
    "warning_needs_response",
    "warning_under_review",
    "warning_closed",
    "needs_response",
    "under_review",
    "won",
    "lost",
    "prevented",
  ]),
  payment_intent: stripeId("paymentIntent").nullable(),
  created: z.number().int(),
});
export type StripeDispute = z.infer<typeof stripeDisputeSchema>;

export const stripeListSchema = z.object({
  object: z.enum(["list", "search_result"]),
  data: z.array(z.unknown()).max(100),
  has_more: z.boolean(),
});

export const stripeErrorSchema = z.object({
  error: z.object({
    type: z.string().max(64),
    code: z.string().max(128).optional(),
  }),
});

export const stripeEventSchema = z.object({
  id: stripeId("event"),
  object: z.literal("event"),
  type: z.string().max(128),
  created: z.number().int(),
  livemode: z.boolean(),
  data: z.object({ object: z.unknown() }),
});
export type StripeEvent = z.infer<typeof stripeEventSchema>;

export function paymentIntentIdOf(session: StripeSession): string | undefined {
  const value = session.payment_intent;
  return value === null
    ? undefined
    : typeof value === "string"
      ? value
      : value.id;
}
