import type { z } from "zod";

import {
  cachePurgePortCommandSchema,
  cachePurgePortErrorSchema,
  cachePurgePortResponseSchema,
} from "./cache-purge-port-contracts.js";

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
import {
  identityPortCommandSchema,
  identityPortErrorSchema,
  identityPortResponseSchema,
} from "./identity-port-contracts.js";
import {
  keyManagementPortCommandSchema,
  keyManagementPortErrorSchema,
  keyManagementPortResponseSchema,
} from "./key-management-port-contracts.js";
import {
  decideIdempotencyInputSchema,
  disputeTransitionCommandSchema,
  disputeTransitionDecisionSchema,
  fulfillmentTransitionCommandSchema,
  fulfillmentTransitionDecisionSchema,
  giftEligibilityDecisionSchema,
  giftEligibilityInputSchema,
  idempotencyDecisionSchema,
  inventoryReservationCreationDecisionSchema,
  inventoryReservationCreationInputSchema,
  inventoryReservationTransitionDecisionSchema,
  inventoryReservationTransitionInputSchema,
  latePaymentSuccessCommandSchema,
  latePaymentSuccessDecisionSchema,
  lineAmountCalculationDecisionSchema,
  lineAmountCalculationInputSchema,
  orderAmountCalculationDecisionSchema,
  orderAmountCalculationInputSchema,
  orderLifecycleTransitionCommandSchema,
  orderLifecycleTransitionDecisionSchema,
  orderPaymentTransitionCommandSchema,
  orderPaymentTransitionDecisionSchema,
  paymentAttemptTransitionCommandSchema,
  paymentAttemptTransitionDecisionSchema,
  paymentRouteDecisionSchema,
  priceSelectionDecisionSchema,
  priceSelectionInputSchema,
  refundCapacityDecisionSchema,
  refundCapacityInputSchema,
  refundTransitionCommandSchema,
  refundTransitionDecisionSchema,
  selectPaymentRouteInputSchema,
} from "./domain-rules.js";
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
  mediaPortCommandSchema,
  mediaPortErrorSchema,
  mediaPortResponseSchema,
} from "./media-port-contracts.js";
import {
  notificationPortCommandSchema,
  notificationPortErrorSchema,
  notificationPortResponseSchema,
} from "./notification-port-contracts.js";
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
import {
  paymentPortCommandSchema,
  paymentPortErrorSchema,
  paymentPortResponseSchema,
} from "./payment-port-contracts.js";
import {
  persistencePortCommandSchema,
  persistencePortErrorSchema,
  persistencePortResponseSchema,
  persistenceTransactionFailureSchema,
  transactionOptionsSchema,
} from "./persistence-port-contracts.js";
import {
  outboxDispatchJobSchema,
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationErrorSchema,
  paymentWebhookVerificationResponseSchema,
  queuePropagationCarrierSchema,
  reliableEventJobSchema,
  verifiedWebhookEventCandidateSchema,
  webhookInboxJobSchema,
} from "./reliable-events.js";

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
  // Application and queue adapters exchange only these versioned roots with
  // the pure commerce-domain functions. Embedded rule/state schemas remain
  // implementation details of their owning input or decision.
  {
    name: "SelectPaymentRouteInput",
    audience: "internal",
    schema: selectPaymentRouteInputSchema,
  },
  {
    name: "PaymentRouteDecision",
    audience: "internal",
    schema: paymentRouteDecisionSchema,
  },
  {
    name: "DecideIdempotencyInput",
    audience: "internal",
    schema: decideIdempotencyInputSchema,
  },
  {
    name: "IdempotencyDecision",
    audience: "internal",
    schema: idempotencyDecisionSchema,
  },
  {
    name: "LineAmountCalculationInput",
    audience: "internal",
    schema: lineAmountCalculationInputSchema,
  },
  {
    name: "LineAmountCalculationDecision",
    audience: "internal",
    schema: lineAmountCalculationDecisionSchema,
  },
  {
    name: "OrderAmountCalculationInput",
    audience: "internal",
    schema: orderAmountCalculationInputSchema,
  },
  {
    name: "OrderAmountCalculationDecision",
    audience: "internal",
    schema: orderAmountCalculationDecisionSchema,
  },
  {
    name: "PriceSelectionInput",
    audience: "internal",
    schema: priceSelectionInputSchema,
  },
  {
    name: "PriceSelectionDecision",
    audience: "internal",
    schema: priceSelectionDecisionSchema,
  },
  {
    name: "GiftEligibilityInput",
    audience: "internal",
    schema: giftEligibilityInputSchema,
  },
  {
    name: "GiftEligibilityDecision",
    audience: "internal",
    schema: giftEligibilityDecisionSchema,
  },
  {
    name: "InventoryReservationCreationInput",
    audience: "internal",
    schema: inventoryReservationCreationInputSchema,
  },
  {
    name: "InventoryReservationCreationDecision",
    audience: "internal",
    schema: inventoryReservationCreationDecisionSchema,
  },
  {
    name: "InventoryReservationTransitionInput",
    audience: "internal",
    schema: inventoryReservationTransitionInputSchema,
  },
  {
    name: "InventoryReservationTransitionDecision",
    audience: "internal",
    schema: inventoryReservationTransitionDecisionSchema,
  },
  {
    name: "RefundCapacityInput",
    audience: "internal",
    schema: refundCapacityInputSchema,
  },
  {
    name: "RefundCapacityDecision",
    audience: "internal",
    schema: refundCapacityDecisionSchema,
  },
  {
    name: "PaymentAttemptTransitionCommand",
    audience: "internal",
    schema: paymentAttemptTransitionCommandSchema,
  },
  {
    name: "PaymentAttemptTransitionDecision",
    audience: "internal",
    schema: paymentAttemptTransitionDecisionSchema,
  },
  {
    name: "OrderLifecycleTransitionCommand",
    audience: "internal",
    schema: orderLifecycleTransitionCommandSchema,
  },
  {
    name: "OrderLifecycleTransitionDecision",
    audience: "internal",
    schema: orderLifecycleTransitionDecisionSchema,
  },
  {
    name: "OrderPaymentTransitionCommand",
    audience: "internal",
    schema: orderPaymentTransitionCommandSchema,
  },
  {
    name: "OrderPaymentTransitionDecision",
    audience: "internal",
    schema: orderPaymentTransitionDecisionSchema,
  },
  {
    name: "RefundTransitionCommand",
    audience: "internal",
    schema: refundTransitionCommandSchema,
  },
  {
    name: "RefundTransitionDecision",
    audience: "internal",
    schema: refundTransitionDecisionSchema,
  },
  {
    name: "DisputeTransitionCommand",
    audience: "internal",
    schema: disputeTransitionCommandSchema,
  },
  {
    name: "DisputeTransitionDecision",
    audience: "internal",
    schema: disputeTransitionDecisionSchema,
  },
  {
    name: "FulfillmentTransitionCommand",
    audience: "internal",
    schema: fulfillmentTransitionCommandSchema,
  },
  {
    name: "FulfillmentTransitionDecision",
    audience: "internal",
    schema: fulfillmentTransitionDecisionSchema,
  },
  {
    name: "LatePaymentSuccessCommand",
    audience: "internal",
    schema: latePaymentSuccessCommandSchema,
  },
  {
    name: "LatePaymentSuccessDecision",
    audience: "internal",
    schema: latePaymentSuccessDecisionSchema,
  },
  {
    name: "PaymentPortCommand",
    audience: "internal",
    schema: paymentPortCommandSchema,
  },
  {
    name: "PaymentPortResponse",
    audience: "internal",
    schema: paymentPortResponseSchema,
  },
  {
    name: "PaymentPortError",
    audience: "internal",
    schema: paymentPortErrorSchema,
  },
  {
    name: "VerifiedWebhookEventCandidate",
    audience: "internal",
    schema: verifiedWebhookEventCandidateSchema,
  },
  {
    name: "PaymentWebhookVerificationCommand",
    audience: "internal",
    schema: paymentWebhookVerificationCommandSchema,
  },
  {
    name: "PaymentWebhookVerificationResponse",
    audience: "internal",
    schema: paymentWebhookVerificationResponseSchema,
  },
  {
    name: "PaymentWebhookVerificationError",
    audience: "internal",
    schema: paymentWebhookVerificationErrorSchema,
  },
  {
    name: "QueuePropagationCarrier",
    audience: "internal",
    schema: queuePropagationCarrierSchema,
  },
  {
    name: "WebhookInboxJob",
    audience: "internal",
    schema: webhookInboxJobSchema,
  },
  {
    name: "OutboxDispatchJob",
    audience: "internal",
    schema: outboxDispatchJobSchema,
  },
  {
    name: "ReliableEventJob",
    audience: "internal",
    schema: reliableEventJobSchema,
  },
  {
    name: "MediaPortCommand",
    audience: "internal",
    schema: mediaPortCommandSchema,
  },
  {
    name: "MediaPortResponse",
    audience: "internal",
    schema: mediaPortResponseSchema,
  },
  {
    name: "MediaPortError",
    audience: "internal",
    schema: mediaPortErrorSchema,
  },
  {
    name: "IdentityPortCommand",
    audience: "internal",
    schema: identityPortCommandSchema,
  },
  {
    name: "IdentityPortResponse",
    audience: "internal",
    schema: identityPortResponseSchema,
  },
  {
    name: "IdentityPortError",
    audience: "internal",
    schema: identityPortErrorSchema,
  },
  {
    name: "NotificationPortCommand",
    audience: "internal",
    schema: notificationPortCommandSchema,
  },
  {
    name: "NotificationPortResponse",
    audience: "internal",
    schema: notificationPortResponseSchema,
  },
  {
    name: "NotificationPortError",
    audience: "internal",
    schema: notificationPortErrorSchema,
  },
  {
    name: "CachePurgePortCommand",
    audience: "internal",
    schema: cachePurgePortCommandSchema,
  },
  {
    name: "CachePurgePortResponse",
    audience: "internal",
    schema: cachePurgePortResponseSchema,
  },
  {
    name: "CachePurgePortError",
    audience: "internal",
    schema: cachePurgePortErrorSchema,
  },
  {
    name: "KeyManagementPortCommand",
    audience: "internal",
    schema: keyManagementPortCommandSchema,
  },
  {
    name: "KeyManagementPortResponse",
    audience: "internal",
    schema: keyManagementPortResponseSchema,
  },
  {
    name: "KeyManagementPortError",
    audience: "internal",
    schema: keyManagementPortErrorSchema,
  },
  {
    name: "PersistencePortCommand",
    audience: "internal",
    schema: persistencePortCommandSchema,
  },
  {
    name: "PersistencePortResponse",
    audience: "internal",
    schema: persistencePortResponseSchema,
  },
  {
    name: "PersistencePortError",
    audience: "internal",
    schema: persistencePortErrorSchema,
  },
  {
    name: "PersistenceTransactionFailure",
    audience: "internal",
    schema: persistenceTransactionFailureSchema,
  },
  {
    name: "TransactionOptions",
    audience: "internal",
    schema: transactionOptionsSchema,
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
