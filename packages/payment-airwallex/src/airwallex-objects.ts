import { z } from "zod";

import { isAirwallexId, type AirwallexObjectKind } from "./references.js";

// Airwallex adds fields without a new API version, so objects are parsed loosely; every
// field the adapter acts on is strict.
const airwallexId = (kind: AirwallexObjectKind) =>
  z.string().refine((value) => isAirwallexId(value, kind));
const amount = z.number().finite().nonnegative();
const currency = z.string().regex(/^[A-Z]{3}$/u);
const metadata = z.record(z.string(), z.unknown()).nullable().optional();

export const airwallexPaymentIntentSchema = z.object({
  id: airwallexId("paymentIntent"),
  request_id: z.string().max(64).optional(),
  amount,
  currency,
  merchant_order_id: z.string().max(64),
  status: z.string().max(64),
  client_secret: z.string().max(4_096).nullable().optional(),
  return_url: z.string().max(2_048).nullable().optional(),
  metadata,
});
export type AirwallexPaymentIntent = z.infer<
  typeof airwallexPaymentIntentSchema
>;

export const airwallexRefundSchema = z.object({
  id: airwallexId("refund"),
  request_id: z.string().max(64).optional(),
  payment_intent_id: airwallexId("paymentIntent"),
  amount,
  currency,
  status: z.enum(["RECEIVED", "ACCEPTED", "SETTLED", "FAILED"]),
  metadata,
});
export type AirwallexRefund = z.infer<typeof airwallexRefundSchema>;

export const airwallexDisputeSchema = z.object({
  id: airwallexId("dispute"),
  payment_intent_id: airwallexId("paymentIntent").nullable().optional(),
  amount,
  currency,
  status: z.enum([
    "REQUIRES_RESPONSE",
    "CHALLENGED",
    "ACCEPTED",
    "REVERSED",
    "WON",
    "LOST",
    "PENDING_CLOSURE",
    "EXPIRED",
    "PENDING_DECISION",
  ]),
  transaction_type: z.enum(["PAYMENT", "REFUND"]).nullable().optional(),
});
export type AirwallexDispute = z.infer<typeof airwallexDisputeSchema>;

export const airwallexListSchema = z.object({
  has_more: z.boolean(),
  items: z.array(z.unknown()).max(1_000),
});

export const airwallexErrorSchema = z.object({
  code: z.string().max(128),
});

export const airwallexLoginSchema = z.object({
  token: z
    .string()
    .min(16)
    .max(8_192)
    .regex(/^[\x21-\x7e]+$/u),
  expires_at: z.string().max(64),
});

export const airwallexEventSchema = z.object({
  id: airwallexId("event"),
  name: z.string().max(128),
  created_at: z.string().max(64),
  data: z.object({ object: z.unknown() }),
});
export type AirwallexEvent = z.infer<typeof airwallexEventSchema>;

/** Airwallex writes offsets as `+0000`; ISO 8601 parsers need `+00:00`. */
export function parseAirwallexTimestamp(value: string): number | undefined {
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  )
    return undefined;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? undefined : time;
}
