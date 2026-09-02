import type { z } from "zod";

import {
  cartGiftContextSchema,
  cartSchema,
  checkoutQuoteSchema,
  checkoutSessionSchema,
  orderAmountSnapshotSchema,
  publicCartViewSchema,
  supportIntentSchema,
} from "./commerce.js";
import {
  giftOfferSchema,
  giftSchema,
  idolSchema,
  inventoryReservationSchema,
  priceBookSchema,
} from "./catalog.js";
import { eventEnvelopeSchema, publicErrorEnvelopeSchema } from "./envelopes.js";
import {
  giftFulfillmentSchema,
  notificationCommandSchema,
  notificationLocaleSnapshotSchema,
} from "./fulfillment-notification.js";
import { localeContextSchema, supportedLocaleSchema } from "./locale.js";
import {
  internalOrderItemSnapshotSchema,
  mediaSnapshotSchema,
  orderSchema,
  policyAcceptanceSnapshotSchema,
  publicOrderItemViewSchema,
  publicOrderViewSchema,
  translationSnapshotRefSchema,
} from "./order.js";
import {
  disputeSchema,
  paymentActionSchema,
  paymentAttemptSchema,
  paymentCapabilitySchema,
  paymentReturnQuerySchema,
  providerEventSchema,
  publicPaymentAttemptViewSchema,
  refundSchema,
} from "./payment.js";

export type ContractAudience = "public-http" | "admin-http" | "internal";

export type ContractRegistration = Readonly<{
  name: string;
  audience: ContractAudience;
  schema: z.ZodType;
  versionedRoot: boolean;
}>;

// Scalars and embedded snapshot value objects follow their versioned parent;
// they must never be used as standalone API, event, or queue roots.
const unversionedValueObjectNames = new Set([
  "SupportedLocale",
  "TranslationSnapshotRef",
  "MediaSnapshot",
]);

const registrations = [
  {
    name: "SupportedLocale",
    audience: "public-http",
    schema: supportedLocaleSchema,
  },
  {
    name: "LocaleContext",
    audience: "public-http",
    schema: localeContextSchema,
  },
  { name: "Idol", audience: "public-http", schema: idolSchema },
  { name: "Gift", audience: "public-http", schema: giftSchema },
  { name: "GiftOffer", audience: "public-http", schema: giftOfferSchema },
  { name: "PriceBook", audience: "admin-http", schema: priceBookSchema },
  {
    name: "InventoryReservation",
    audience: "internal",
    schema: inventoryReservationSchema,
  },
  { name: "Cart", audience: "internal", schema: cartSchema },
  {
    name: "PublicCartView",
    audience: "public-http",
    schema: publicCartViewSchema,
  },
  {
    name: "CartGiftContext",
    audience: "public-http",
    schema: cartGiftContextSchema,
  },
  { name: "SupportIntent", audience: "internal", schema: supportIntentSchema },
  {
    name: "CheckoutQuote",
    audience: "public-http",
    schema: checkoutQuoteSchema,
  },
  {
    name: "OrderAmountSnapshot",
    audience: "internal",
    schema: orderAmountSnapshotSchema,
  },
  {
    name: "CheckoutSession",
    audience: "public-http",
    schema: checkoutSessionSchema,
  },
  {
    name: "PaymentCapability",
    audience: "public-http",
    schema: paymentCapabilitySchema,
  },
  {
    name: "PaymentAction",
    audience: "public-http",
    schema: paymentActionSchema,
  },
  {
    name: "PaymentAttempt",
    audience: "internal",
    schema: paymentAttemptSchema,
  },
  {
    name: "PublicPaymentAttemptView",
    audience: "public-http",
    schema: publicPaymentAttemptViewSchema,
  },
  {
    name: "PaymentReturnQuery",
    audience: "public-http",
    schema: paymentReturnQuerySchema,
  },
  { name: "ProviderEvent", audience: "internal", schema: providerEventSchema },
  {
    name: "TranslationSnapshotRef",
    audience: "internal",
    schema: translationSnapshotRefSchema,
  },
  { name: "MediaSnapshot", audience: "internal", schema: mediaSnapshotSchema },
  {
    name: "InternalOrderItemSnapshot",
    audience: "internal",
    schema: internalOrderItemSnapshotSchema,
  },
  {
    name: "PublicOrderItemView",
    audience: "public-http",
    schema: publicOrderItemViewSchema,
  },
  {
    name: "PolicyAcceptanceSnapshot",
    audience: "internal",
    schema: policyAcceptanceSnapshotSchema,
  },
  { name: "Order", audience: "internal", schema: orderSchema },
  {
    name: "PublicOrderView",
    audience: "public-http",
    schema: publicOrderViewSchema,
  },
  { name: "Refund", audience: "admin-http", schema: refundSchema },
  { name: "Dispute", audience: "admin-http", schema: disputeSchema },
  {
    name: "GiftFulfillment",
    audience: "admin-http",
    schema: giftFulfillmentSchema,
  },
  {
    name: "NotificationLocaleSnapshot",
    audience: "internal",
    schema: notificationLocaleSnapshotSchema,
  },
  {
    name: "NotificationCommand",
    audience: "internal",
    schema: notificationCommandSchema,
  },
  {
    name: "PublicErrorEnvelope",
    audience: "public-http",
    schema: publicErrorEnvelopeSchema,
  },
  { name: "EventEnvelope", audience: "internal", schema: eventEnvelopeSchema },
] as const;

export const contractArtifactRegistry: readonly ContractRegistration[] =
  Object.freeze(
    registrations.map((registration) =>
      Object.freeze({
        ...registration,
        versionedRoot: !unversionedValueObjectNames.has(registration.name),
      }),
    ),
  );
