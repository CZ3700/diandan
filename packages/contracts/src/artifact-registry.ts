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
import {
  giftBaseSchema,
  contentPublicationCandidateSchema,
  giftPublicationCandidateSchema,
  giftRevisionMediaSchema,
  giftRevisionSchema,
  giftRevisionTranslationSchema,
  giftVariantDefinitionSchema,
  giftVariantIdolEligibilitySchema,
  homepageRevisionSchema,
  homepageRevisionTranslationSchema,
  homepageSlotSchema,
  homepagePublicationCandidateSchema,
  homepagePublicProjectionSourceSchema,
  idolBaseSchema,
  idolPublicationCandidateSchema,
  idolPublicProjectionSourceSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLedgerEntrySchema,
  inventoryLocationSchema,
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
  policyRevisionSchema,
  policyRevisionTranslationSchema,
  policyPublicationCandidateSchema,
  policyPublicProjectionSourceSchema,
  priceBookRevisionSchema,
  priceSchema,
  contentPublicationSchema,
  publicRevisionSelectionSchema,
  publicationValidationReportSchema,
  publishedGiftViewSchema,
  publishedHomepageViewSchema,
  publishedIdolViewSchema,
  publishedMediaViewSchema,
  publishedPolicyViewSchema,
  giftPublicProjectionSourceSchema,
  publicMediaProjectionSourceSchema,
  translationApprovalEvidenceSchema,
  translationPublicationManifestEntrySchema,
  translationImportPackageSchema,
  translationImportValidationReportSchema,
} from "./content.js";
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
  // P1-01 compatibility schemas remain importable for existing internal
  // consumers. HTTP routes must use the stronger P1-02 publication contracts.
  { name: "Idol", audience: "internal", schema: idolSchema },
  { name: "Gift", audience: "internal", schema: giftSchema },
  {
    name: "PublishedIdolView",
    audience: "public-http",
    schema: publishedIdolViewSchema,
  },
  {
    name: "PublishedGiftView",
    audience: "public-http",
    schema: publishedGiftViewSchema,
  },
  { name: "IdolBase", audience: "admin-http", schema: idolBaseSchema },
  {
    name: "IdolRevision",
    audience: "admin-http",
    schema: idolRevisionSchema,
  },
  {
    name: "IdolRevisionTranslation",
    audience: "admin-http",
    schema: idolRevisionTranslationSchema,
  },
  {
    name: "IdolRevisionMedia",
    audience: "admin-http",
    schema: idolRevisionMediaSchema,
  },
  { name: "GiftBase", audience: "admin-http", schema: giftBaseSchema },
  {
    name: "GiftRevision",
    audience: "admin-http",
    schema: giftRevisionSchema,
  },
  {
    name: "GiftRevisionTranslation",
    audience: "admin-http",
    schema: giftRevisionTranslationSchema,
  },
  {
    name: "GiftVariantDefinition",
    audience: "admin-http",
    schema: giftVariantDefinitionSchema,
  },
  {
    name: "GiftVariantIdolEligibility",
    audience: "admin-http",
    schema: giftVariantIdolEligibilitySchema,
  },
  {
    name: "GiftRevisionMedia",
    audience: "admin-http",
    schema: giftRevisionMediaSchema,
  },
  {
    name: "GiftPublicationCandidate",
    audience: "internal",
    schema: giftPublicationCandidateSchema,
  },
  {
    name: "IdolPublicationCandidate",
    audience: "internal",
    schema: idolPublicationCandidateSchema,
  },
  {
    name: "HomepagePublicationCandidate",
    audience: "internal",
    schema: homepagePublicationCandidateSchema,
  },
  {
    name: "PolicyPublicationCandidate",
    audience: "internal",
    schema: policyPublicationCandidateSchema,
  },
  {
    name: "ContentPublicationCandidate",
    audience: "internal",
    schema: contentPublicationCandidateSchema,
  },
  {
    name: "TranslationApprovalEvidence",
    audience: "internal",
    schema: translationApprovalEvidenceSchema,
  },
  {
    name: "TranslationPublicationManifestEntry",
    audience: "internal",
    schema: translationPublicationManifestEntrySchema,
  },
  {
    name: "ContentPublication",
    audience: "internal",
    schema: contentPublicationSchema,
  },
  {
    name: "PublicRevisionSelection",
    audience: "internal",
    schema: publicRevisionSelectionSchema,
  },
  {
    name: "PublicMediaProjectionSource",
    audience: "internal",
    schema: publicMediaProjectionSourceSchema,
  },
  {
    name: "IdolPublicProjectionSource",
    audience: "internal",
    schema: idolPublicProjectionSourceSchema,
  },
  {
    name: "GiftPublicProjectionSource",
    audience: "internal",
    schema: giftPublicProjectionSourceSchema,
  },
  {
    name: "HomepagePublicProjectionSource",
    audience: "internal",
    schema: homepagePublicProjectionSourceSchema,
  },
  {
    name: "PolicyPublicProjectionSource",
    audience: "internal",
    schema: policyPublicProjectionSourceSchema,
  },
  {
    name: "PublicationValidationReport",
    audience: "admin-http",
    schema: publicationValidationReportSchema,
  },
  {
    name: "TranslationImportPackage",
    audience: "admin-http",
    schema: translationImportPackageSchema,
  },
  {
    name: "TranslationImportValidationReport",
    audience: "admin-http",
    schema: translationImportValidationReportSchema,
  },
  {
    name: "HomepageRevision",
    audience: "admin-http",
    schema: homepageRevisionSchema,
  },
  {
    name: "HomepageRevisionTranslation",
    audience: "admin-http",
    schema: homepageRevisionTranslationSchema,
  },
  {
    name: "HomepageSlot",
    audience: "admin-http",
    schema: homepageSlotSchema,
  },
  {
    name: "PublishedHomepageView",
    audience: "public-http",
    schema: publishedHomepageViewSchema,
  },
  {
    name: "PolicyRevision",
    audience: "admin-http",
    schema: policyRevisionSchema,
  },
  {
    name: "PolicyRevisionTranslation",
    audience: "admin-http",
    schema: policyRevisionTranslationSchema,
  },
  {
    name: "PublishedPolicyView",
    audience: "public-http",
    schema: publishedPolicyViewSchema,
  },
  { name: "MediaAsset", audience: "internal", schema: mediaAssetSchema },
  { name: "MediaVariant", audience: "internal", schema: mediaVariantSchema },
  {
    name: "MediaMetadataRevision",
    audience: "admin-http",
    schema: mediaMetadataRevisionSchema,
  },
  {
    name: "MediaMetadataRevisionTranslation",
    audience: "admin-http",
    schema: mediaMetadataRevisionTranslationSchema,
  },
  {
    name: "PublishedMediaView",
    audience: "public-http",
    schema: publishedMediaViewSchema,
  },
  { name: "GiftOffer", audience: "public-http", schema: giftOfferSchema },
  { name: "PriceBook", audience: "internal", schema: priceBookSchema },
  {
    name: "PriceBookRevision",
    audience: "admin-http",
    schema: priceBookRevisionSchema,
  },
  { name: "Price", audience: "admin-http", schema: priceSchema },
  {
    name: "InventoryLocation",
    audience: "admin-http",
    schema: inventoryLocationSchema,
  },
  {
    name: "InventoryItem",
    audience: "admin-http",
    schema: inventoryItemSchema,
  },
  {
    name: "InventoryBalance",
    audience: "admin-http",
    schema: inventoryBalanceSchema,
  },
  {
    name: "InventoryLedgerEntry",
    audience: "admin-http",
    schema: inventoryLedgerEntrySchema,
  },
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
