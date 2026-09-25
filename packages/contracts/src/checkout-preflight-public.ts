import { z } from "zod";
import { cartRuntimeQuantitySchema } from "./cart-runtime.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { contentLocaleContextSchema } from "./content-provenance.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import {
  cartItemIdSchema,
  checkoutSessionIdSchema,
  publicOrderIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publicOrderAmountViewSchema } from "./order.js";
import {
  checkoutPreflightFailureSchema,
  checkoutPreflightIdSchema,
  checkoutText,
  checkoutVersionSchema,
} from "./checkout-preflight.js";
import { checkoutPreflightPolicyFactsSchema } from "./checkout-preflight-internal.js";

export const checkoutPreflightPublicLineSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cartItemId: cartItemIdSchema,
    idolDisplayName: checkoutText(40),
    giftTitle: checkoutText(160),
    giftVariantLabel: checkoutText(80),
    idolLocaleContext: contentLocaleContextSchema,
    giftLocaleContext: contentLocaleContextSchema,
    quantity: cartRuntimeQuantitySchema,
    unitAmountMinor: minorAmountSchema,
    lineSubtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
  })
  .refine(
    (line) =>
      BigInt(line.unitAmountMinor) * BigInt(line.quantity) ===
        BigInt(line.lineSubtotalMinor) &&
      BigInt(line.lineSubtotalMinor) +
        BigInt(line.taxAmountMinor) -
        BigInt(line.discountAmountMinor) ===
        BigInt(line.lineTotalMinor),
  );
export const checkoutPreflightPublicPolicySchema =
  checkoutPreflightPolicyFactsSchema.omit({
    publicationId: true,
    manifestHash: true,
    sourceHash: true,
  });
const review = {
  schemaVersion: z.literal(1),
  presentationLocale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
  amount: publicOrderAmountViewSchema,
  lines: z.array(checkoutPreflightPublicLineSchema).min(1).max(500),
  policies: z.array(checkoutPreflightPublicPolicySchema).min(1).max(500),
};
type Review = z.infer<ReturnType<typeof z.strictObject<typeof review>>>;
function consistent(value: Review, context: z.RefinementCtx) {
  const total = (
    field:
      | "lineSubtotalMinor"
      | "taxAmountMinor"
      | "discountAmountMinor"
      | "lineTotalMinor",
  ) => value.lines.reduce((sum, line) => sum + BigInt(line[field]), 0n);
  if (
    value.amount.currency !== value.currency ||
    total("lineSubtotalMinor") !== BigInt(value.amount.subtotalMinor) ||
    total("taxAmountMinor") !== BigInt(value.amount.taxAmountMinor) ||
    total("discountAmountMinor") !== BigInt(value.amount.discountAmountMinor) ||
    total("lineTotalMinor") +
      BigInt(value.amount.shippingAmountMinor) +
      BigInt(value.amount.feeAmountMinor) !==
      BigInt(value.amount.totalAmountMinor) ||
    new Set(value.lines.map((line) => line.cartItemId.toLowerCase())).size !==
      value.lines.length ||
    new Set(value.policies.map((policy) => policy.policyKey)).size !==
      value.policies.length ||
    value.policies.some(
      (policy) => policy.locale !== value.presentationLocale,
    ) ||
    value.lines.some(
      (line) =>
        line.idolLocaleContext.requestedLocale !== value.presentationLocale ||
        line.giftLocaleContext.requestedLocale !== value.presentationLocale,
    )
  )
    context.addIssue({
      code: "custom",
      message: "Public checkout lines, policy languages and amount must agree",
    });
}
export const checkoutPreflightViewSchema = z
  .strictObject({
    ...review,
    id: checkoutPreflightIdSchema,
    cartVersion: checkoutVersionSchema,
    expiresAt: contentTimestampSchema,
  })
  .superRefine(consistent);
export const checkoutSessionViewSchema = z
  .strictObject({
    ...review,
    id: checkoutSessionIdSchema,
    publicOrderId: publicOrderIdSchema,
    status: z.enum([
      "CREATED",
      "READY",
      "PAYMENT_PENDING",
      "COMPLETED",
      "EXPIRED",
    ]),
    orderStatus: z.enum([
      "DRAFT",
      "PENDING_PAYMENT",
      "OPEN",
      "CLOSED",
      "CANCELED",
    ]),
    paymentStatus: z.enum([
      "UNPAID",
      "PENDING",
      "PAID",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
    ]),
    expired: z.boolean(),
    quoteRevision: checkoutVersionSchema,
    quoteExpiresAt: contentTimestampSchema,
  })
  .superRefine(consistent);
export const checkoutPreflightResponseSchema = z.union([
  checkoutPreflightFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.literal("VALIDATED"),
    replayed: z.boolean(),
    preflight: checkoutPreflightViewSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.enum(["CREATED", "REPLAYED", "READ"]),
    checkout: checkoutSessionViewSchema,
  }),
]);
export type CheckoutPreflightPublicLine = z.infer<
  typeof checkoutPreflightPublicLineSchema
>;
export type CheckoutPreflightPublicPolicy = z.infer<
  typeof checkoutPreflightPublicPolicySchema
>;
export type CheckoutPreflightView = z.infer<typeof checkoutPreflightViewSchema>;
export type CheckoutSessionView = z.infer<typeof checkoutSessionViewSchema>;
export type CheckoutPreflightResponse = z.infer<
  typeof checkoutPreflightResponseSchema
>;
