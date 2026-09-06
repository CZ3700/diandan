import {
  adminSessionCommandSchema,
  adminSessionRequestSchema,
  adminSessionResponseSchema,
  adminSessionBootstrapResponseSchema,
  adminSessionReadCommandSchema,
} from "./admin-session.js";
import {
  adminCatalogCommandSchema,
  adminCatalogRequestSchema,
  adminCatalogOwnerSchema,
  adminCatalogMutationSchema,
  adminCatalogResponseSchema,
  adminCatalogReadCommandSchema,
  adminCatalogWriteCommandSchema,
  adminCatalogReceiptReadCommandSchema,
  idolHandleResolutionCommandSchema,
  idolHandleResolutionSchema,
} from "./admin-catalog.js";
import {
  translationWorkspaceCommandSchema,
  translationWorkspaceRequestSchema,
  translationWorkspaceResponseSchema,
  translationWorkspaceContextSchema,
  translationWorkspaceContextResponseSchema,
} from "./translation-workspace.js";
import {
  translationTransferPackageSchema,
  translationTransferCommandSchema,
  translationTransferRequestSchema,
  translationTransferResponseSchema,
  translationExportReceiptSchema,
  translationExportReceiptResponseSchema,
  translationExportCreateCommandSchema,
  translationExportReadCommandSchema,
  translationImportRecordCommandSchema,
} from "./translation-transfer.js";
import {
  adminPreviewMediaRequestSchema,
  adminPreviewMediaResponseSchema,
  adminPreviewMediaContextSchema,
  adminPreviewMediaContextResponseSchema,
} from "./admin-preview-media.js";
import {
  publicationManifestRevisionSchema,
  publicationManifestAssetSchema,
  publicationManifestVariantSchema,
  publicationManifestSchema,
  publicationManifestRecordSchema,
} from "./publication-manifest.js";
import {
  publishedContentReadCommandSchema,
  publishedContentResponseSchema,
  publishedContentContextSchema,
  publishedContentContextResponseSchema,
  publishedContentFailureSchema,
} from "./published-content.js";
import {
  publicationAuthorizationCommandSchema,
  publicationRevisionCommandSchema,
  publicationStatusCommandSchema,
  publicationRetryCommandSchema,
  publicationRuntimeCommandSchema,
  publicationRuntimeRequestSchema,
  publicationRuntimeMutationSchema,
  publicationPurgeRetryResultSchema,
  publicationStatusResponseSchema,
  publicationRuntimeResponseSchema,
  publicationRuntimeContextSchema,
  publicationRuntimeContextResponseSchema,
  publicationRuntimeWriteCommandSchema,
  publicationRuntimeReceiptReadCommandSchema,
  publicationRuntimeRetryWriteCommandSchema,
} from "./publication-runtime.js";
import {
  publicationPurgeJobSchema,
  publicationPurgeClaimCommandSchema,
  publicationPurgeClaimSchema,
  publicationPurgeClaimResponseSchema,
  publicationPurgeRecordCommandSchema,
  publicationPurgeRecordResponseSchema,
  publicationPurgeRunResultSchema,
} from "./publication-purge.js";
import {
  publicationPreflightCommandSchema,
  publicationPreflightRequestSchema,
  publicationPreflightResponseSchema,
  publicationPreflightContextSchema,
  publicationPreflightContextResponseSchema,
} from "./publication-preflight.js";
import {
  mediaSourceInspectionCommandSchema,
  mediaSourceInspectionReceiptSchema,
  mediaSourceInspectionResponseSchema,
  adminResourceAuthorizationCommandSchema,
  adminResourceCommandSchema,
  adminResourceRequestSchema,
  resourcePolicySnapshotSchema,
  resourcePolicyResponseSchema,
  mediaUploadTicketSchema,
  mediaUploadTicketResponseSchema,
  mediaUploadSnapshotSchema,
  mediaUploadResponseSchema,
  mediaUploadGrantResponseSchema,
  resourceMediaSnapshotSchema,
  resourceMediaResponseSchema,
  resourceMediaJobSnapshotSchema,
  resourceMediaJobResponseSchema,
  adminResourceResponseSchema,
  resourcePolicyReadCommandSchema,
  resourcePolicyRegisterCommandSchema,
  mediaUploadReserveCommandSchema,
  mediaUploadReadCommandSchema,
  mediaUploadRegisterCommandSchema,
  resourceMediaReadCommandSchema,
  mediaRightsSetCommandSchema,
  resourceMediaEnqueueCommandSchema,
  resourceMediaJobReadCommandSchema,
  resourceMediaRetryCommandSchema,
} from "./resource-management.js";
import {
  baseContentReviewContextSchema,
  baseContentReviewReadCommandSchema,
  baseContentReviewResponseSchema,
  appendBaseContentReviewCommandSchema,
  baseContentPreviewResponseSchema,
  issueBaseContentPreviewCommandSchema,
  readBaseContentPreviewCommandSchema,
  revokeBaseContentPreviewCommandSchema,
  baseContentPreviewGrantResponseSchema,
  baseContentPreviewRequestSchema,
  baseContentCommandSchema,
  baseContentRequestSchema,
  baseContentResponseSchema,
} from "./base-content.js";
import {
  contentAuthoringCommandSchema,
  contentAuthoringSnapshotSchema,
  contentAuthoringPlanSchema,
  contentAuthoringReadCommandSchema,
  contentAuthoringWriteCommandSchema,
  contentAuthoringReadResponseSchema,
  contentAuthoringResponseSchema,
  contentAuthoringRequestSchema,
} from "./content-authoring.js";
import { contentReviewResponseSchema } from "./admin-content.js";
import { contentReviewReadCommandSchema } from "./admin-content.js";
import {
  adminContentFailureSchema,
  adminAuthorizationCommandSchema,
  adminPrincipalSchema,
  adminAuthorizationResponseSchema,
  contentReviewContextSchema,
  contentReviewContextResponseSchema,
  appendContentReviewCommandSchema,
  adminMutationResponseSchema,
  issueContentPreviewCommandSchema,
  contentPreviewGrantResponseSchema,
  readContentPreviewCommandSchema,
  revokeContentPreviewCommandSchema,
  contentPreviewRequestSchema,
  contentPreviewResponseSchema,
  adminContentCommandSchema,
  adminContentRequestSchema,
  adminContentResponseSchema,
} from "./admin-content.js";
import {
  idolAliasSetSchema,
  createIdolAliasDraftCommandSchema,
  createGiftDetailDraftCommandSchema,
  contentDraftReadCommandSchema,
  contentDraftFailureSchema,
  idolAliasDraftResponseSchema,
  giftDetailDraftResponseSchema,
  contentDraftResponseSchema,
} from "./content-drafts.js";
import {
  mediaImageProcessingCommandSchema,
  mediaImageProcessingSuccessSchema,
  mediaImageProcessingResultSchema,
  mediaProcessingEnqueueCommandSchema,
  mediaProcessingReadCommandSchema,
  mediaProcessingClaimCommandSchema,
  mediaProcessingClaimSchema,
  mediaProcessingSnapshotSchema,
  mediaProcessingRepositoryFailureSchema,
  mediaProcessingSnapshotResponseSchema,
  mediaProcessingClaimResponseSchema,
  mediaProcessingCompleteCommandSchema,
  mediaProcessingFailCommandSchema,
  mediaProcessingRunResultSchema,
} from "./media-processing.js";
import {
  idolDirectoryCursorSchema,
  idolDirectoryReadCommandSchema,
  giftDirectoryReadCommandSchema,
  idolDirectoryRecordSchema,
  giftDirectoryRecordSchema,
  catalogDirectoryOfferSchema,
  catalogDirectoryFailureSchema,
  idolDirectorySnapshotSchema,
  giftDirectorySnapshotSchema,
  idolDirectoryResponseSchema,
  giftDirectoryResponseSchema,
  idolDirectoryCursorEncodingInputSchema,
  idolDirectoryCursorDecodingInputSchema,
} from "./catalog-directory.js";
import type { z } from "zod";

import {
  idolDiscoveryQuerySchema,
  giftDiscoveryQuerySchema,
  catalogPageInfoSchema,
  idolDiscoveryPlanSchema,
  giftDiscoveryPlanSchema,
  changeGiftDiscoveryQuerySchema,
  catalogPageRequestSchema,
  discoveryCacheInputSchema,
  discoveryCacheKeySchema,
} from "./catalog-discovery.js";
import {
  giftDetailDocumentSchema,
  giftDetailTranslationSchema,
  giftDetailValidationInputSchema,
  giftDetailValidationReportSchema,
} from "./gift-details.js";
import {
  mediaFramingRequestSchema,
  mediaFramingPlanSchema,
  mediaFramingResultSchema,
} from "./media-framing.js";

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
  encryptedWebhookPayloadSchema,
  paymentWebhookEndpointDescriptorSchema,
  reliableEventPersistenceCommandSchema,
  reliableEventPersistenceResponseSchema,
} from "./reliable-event-persistence-contracts.js";
import {
  outboxDispatchJobSchema,
  paymentWebhookAcceptedResponseSchema,
  paymentWebhookEndpointPreflightCommandSchema,
  paymentWebhookEndpointPreflightResultSchema,
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationErrorSchema,
  paymentWebhookVerificationResponseSchema,
  queuePropagationCarrierSchema,
  receivePaymentWebhookCommandSchema,
  receivePaymentWebhookErrorSchema,
  receivePaymentWebhookResponseSchema,
  reliableEventDeliveryContextSchema,
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
    name: "DiscoveryCacheInput",
    audience: "internal",
    schema: discoveryCacheInputSchema,
  },
  {
    name: "DiscoveryCacheKey",
    audience: "internal",
    schema: discoveryCacheKeySchema,
  },
  {
    name: "IdolDiscoveryQuery",
    audience: "public-http",
    schema: idolDiscoveryQuerySchema,
  },
  {
    name: "GiftDiscoveryQuery",
    audience: "public-http",
    schema: giftDiscoveryQuerySchema,
  },
  {
    name: "CatalogPageInfo",
    audience: "public-http",
    schema: catalogPageInfoSchema,
  },
  {
    name: "IdolDiscoveryPlan",
    audience: "internal",
    schema: idolDiscoveryPlanSchema,
  },
  {
    name: "GiftDiscoveryPlan",
    audience: "internal",
    schema: giftDiscoveryPlanSchema,
  },
  {
    name: "ChangeGiftDiscoveryQuery",
    audience: "internal",
    schema: changeGiftDiscoveryQuerySchema,
  },
  {
    name: "CatalogPageRequest",
    audience: "internal",
    schema: catalogPageRequestSchema,
  },
  {
    name: "MediaFramingRequest",
    audience: "internal",
    schema: mediaFramingRequestSchema,
  },
  {
    name: "MediaFramingPlan",
    audience: "internal",
    schema: mediaFramingPlanSchema,
  },
  {
    name: "MediaFramingResult",
    audience: "internal",
    schema: mediaFramingResultSchema,
  },
  {
    name: "GiftDetailDocument",
    audience: "admin-http",
    schema: giftDetailDocumentSchema,
  },
  {
    name: "GiftDetailTranslation",
    audience: "admin-http",
    schema: giftDetailTranslationSchema,
  },
  {
    name: "GiftDetailValidationInput",
    audience: "internal",
    schema: giftDetailValidationInputSchema,
  },
  {
    name: "GiftDetailValidationReport",
    audience: "internal",
    schema: giftDetailValidationReportSchema,
  },
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
    name: "PaymentWebhookEndpointPreflightCommand",
    audience: "internal",
    schema: paymentWebhookEndpointPreflightCommandSchema,
  },
  {
    name: "PaymentWebhookEndpointPreflightResult",
    audience: "internal",
    schema: paymentWebhookEndpointPreflightResultSchema,
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
    name: "ReceivePaymentWebhookCommand",
    audience: "internal",
    schema: receivePaymentWebhookCommandSchema,
  },
  {
    name: "ReceivePaymentWebhookResponse",
    audience: "internal",
    schema: receivePaymentWebhookResponseSchema,
  },
  {
    name: "ReceivePaymentWebhookError",
    audience: "internal",
    schema: receivePaymentWebhookErrorSchema,
  },
  {
    name: "PaymentWebhookAcceptedResponse",
    audience: "public-http",
    schema: paymentWebhookAcceptedResponseSchema,
  },
  {
    name: "ReliableEventDeliveryContext",
    audience: "internal",
    schema: reliableEventDeliveryContextSchema,
  },
  {
    name: "PaymentWebhookEndpointDescriptor",
    audience: "internal",
    schema: paymentWebhookEndpointDescriptorSchema,
  },
  {
    name: "EncryptedWebhookPayload",
    audience: "internal",
    schema: encryptedWebhookPayloadSchema,
  },
  {
    name: "ReliableEventPersistenceCommand",
    audience: "internal",
    schema: reliableEventPersistenceCommandSchema,
  },
  {
    name: "ReliableEventPersistenceResponse",
    audience: "internal",
    schema: reliableEventPersistenceResponseSchema,
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

  {
    name: "IdolDirectoryCursor",
    audience: "internal",
    schema: idolDirectoryCursorSchema,
  },
  {
    name: "IdolDirectoryReadCommand",
    audience: "internal",
    schema: idolDirectoryReadCommandSchema,
  },
  {
    name: "GiftDirectoryReadCommand",
    audience: "internal",
    schema: giftDirectoryReadCommandSchema,
  },
  {
    name: "IdolDirectoryRecord",
    audience: "internal",
    schema: idolDirectoryRecordSchema,
  },
  {
    name: "GiftDirectoryRecord",
    audience: "internal",
    schema: giftDirectoryRecordSchema,
  },
  {
    name: "CatalogDirectoryOffer",
    audience: "internal",
    schema: catalogDirectoryOfferSchema,
  },
  {
    name: "CatalogDirectoryFailure",
    audience: "internal",
    schema: catalogDirectoryFailureSchema,
  },
  {
    name: "IdolDirectorySnapshot",
    audience: "internal",
    schema: idolDirectorySnapshotSchema,
  },
  {
    name: "GiftDirectorySnapshot",
    audience: "internal",
    schema: giftDirectorySnapshotSchema,
  },
  {
    name: "IdolDirectoryResponse",
    audience: "public-http",
    schema: idolDirectoryResponseSchema,
  },
  {
    name: "GiftDirectoryResponse",
    audience: "public-http",
    schema: giftDirectoryResponseSchema,
  },
  {
    name: "IdolDirectoryCursorEncodingInput",
    audience: "internal",
    schema: idolDirectoryCursorEncodingInputSchema,
  },
  {
    name: "IdolDirectoryCursorDecodingInput",
    audience: "internal",
    schema: idolDirectoryCursorDecodingInputSchema,
  },
  {
    name: "MediaImageProcessingCommand",
    audience: "internal",
    schema: mediaImageProcessingCommandSchema,
  },
  {
    name: "MediaImageProcessingSuccess",
    audience: "internal",
    schema: mediaImageProcessingSuccessSchema,
  },
  {
    name: "MediaImageProcessingResult",
    audience: "internal",
    schema: mediaImageProcessingResultSchema,
  },
  {
    name: "MediaProcessingEnqueueCommand",
    audience: "internal",
    schema: mediaProcessingEnqueueCommandSchema,
  },
  {
    name: "MediaProcessingReadCommand",
    audience: "internal",
    schema: mediaProcessingReadCommandSchema,
  },
  {
    name: "MediaProcessingClaimCommand",
    audience: "internal",
    schema: mediaProcessingClaimCommandSchema,
  },
  {
    name: "MediaProcessingClaim",
    audience: "internal",
    schema: mediaProcessingClaimSchema,
  },
  {
    name: "MediaProcessingSnapshot",
    audience: "internal",
    schema: mediaProcessingSnapshotSchema,
  },
  {
    name: "MediaProcessingRepositoryFailure",
    audience: "internal",
    schema: mediaProcessingRepositoryFailureSchema,
  },
  {
    name: "MediaProcessingSnapshotResponse",
    audience: "internal",
    schema: mediaProcessingSnapshotResponseSchema,
  },
  {
    name: "MediaProcessingClaimResponse",
    audience: "internal",
    schema: mediaProcessingClaimResponseSchema,
  },
  {
    name: "MediaProcessingCompleteCommand",
    audience: "internal",
    schema: mediaProcessingCompleteCommandSchema,
  },
  {
    name: "MediaProcessingFailCommand",
    audience: "internal",
    schema: mediaProcessingFailCommandSchema,
  },
  {
    name: "MediaProcessingRunResult",
    audience: "internal",
    schema: mediaProcessingRunResultSchema,
  },
  { name: "IdolAliasSet", audience: "internal", schema: idolAliasSetSchema },
  {
    name: "CreateIdolAliasDraftCommand",
    audience: "internal",
    schema: createIdolAliasDraftCommandSchema,
  },
  {
    name: "CreateGiftDetailDraftCommand",
    audience: "internal",
    schema: createGiftDetailDraftCommandSchema,
  },
  {
    name: "ContentDraftReadCommand",
    audience: "internal",
    schema: contentDraftReadCommandSchema,
  },
  {
    name: "ContentDraftFailure",
    audience: "internal",
    schema: contentDraftFailureSchema,
  },
  {
    name: "IdolAliasDraftResponse",
    audience: "internal",
    schema: idolAliasDraftResponseSchema,
  },
  {
    name: "GiftDetailDraftResponse",
    audience: "internal",
    schema: giftDetailDraftResponseSchema,
  },
  {
    name: "ContentDraftResponse",
    audience: "internal",
    schema: contentDraftResponseSchema,
  },
  {
    name: "AdminContentFailure",
    audience: "admin-http",
    schema: adminContentFailureSchema,
  },
  {
    name: "AdminAuthorizationCommand",
    audience: "internal",
    schema: adminAuthorizationCommandSchema,
  },
  {
    name: "AdminPrincipal",
    audience: "internal",
    schema: adminPrincipalSchema,
  },
  {
    name: "AdminAuthorizationResponse",
    audience: "internal",
    schema: adminAuthorizationResponseSchema,
  },
  {
    name: "ContentReviewContext",
    audience: "internal",
    schema: contentReviewContextSchema,
  },
  {
    name: "ContentReviewContextResponse",
    audience: "internal",
    schema: contentReviewContextResponseSchema,
  },
  {
    name: "AppendContentReviewCommand",
    audience: "internal",
    schema: appendContentReviewCommandSchema,
  },
  {
    name: "AdminMutationResponse",
    audience: "internal",
    schema: adminMutationResponseSchema,
  },
  {
    name: "IssueContentPreviewCommand",
    audience: "internal",
    schema: issueContentPreviewCommandSchema,
  },
  {
    name: "ContentPreviewGrantResponse",
    audience: "internal",
    schema: contentPreviewGrantResponseSchema,
  },
  {
    name: "ReadContentPreviewCommand",
    audience: "internal",
    schema: readContentPreviewCommandSchema,
  },
  {
    name: "RevokeContentPreviewCommand",
    audience: "internal",
    schema: revokeContentPreviewCommandSchema,
  },
  {
    name: "ContentPreviewRequest",
    audience: "internal",
    schema: contentPreviewRequestSchema,
  },
  {
    name: "ContentPreviewResponse",
    audience: "admin-http",
    schema: contentPreviewResponseSchema,
  },
  {
    name: "AdminContentCommand",
    audience: "internal",
    schema: adminContentCommandSchema,
  },
  {
    name: "AdminContentRequest",
    audience: "internal",
    schema: adminContentRequestSchema,
  },
  {
    name: "AdminContentResponse",
    audience: "admin-http",
    schema: adminContentResponseSchema,
  },
  {
    name: "ContentReviewReadCommand",
    audience: "internal",
    schema: contentReviewReadCommandSchema,
  },
  {
    name: "ContentReviewResponse",
    audience: "admin-http",
    schema: contentReviewResponseSchema,
  },
  {
    name: "ContentAuthoringCommand",
    audience: "internal",
    schema: contentAuthoringCommandSchema,
  },
  {
    name: "ContentAuthoringSnapshot",
    audience: "internal",
    schema: contentAuthoringSnapshotSchema,
  },
  {
    name: "ContentAuthoringPlan",
    audience: "internal",
    schema: contentAuthoringPlanSchema,
  },
  {
    name: "ContentAuthoringReadCommand",
    audience: "internal",
    schema: contentAuthoringReadCommandSchema,
  },
  {
    name: "ContentAuthoringWriteCommand",
    audience: "internal",
    schema: contentAuthoringWriteCommandSchema,
  },
  {
    name: "ContentAuthoringReadResponse",
    audience: "admin-http",
    schema: contentAuthoringReadResponseSchema,
  },
  {
    name: "ContentAuthoringResponse",
    audience: "admin-http",
    schema: contentAuthoringResponseSchema,
  },
  {
    name: "ContentAuthoringRequest",
    audience: "internal",
    schema: contentAuthoringRequestSchema,
  },
  {
    name: "PublicationPreflightCommand",
    audience: "admin-http",
    schema: publicationPreflightCommandSchema,
  },
  {
    name: "PublicationPreflightRequest",
    audience: "internal",
    schema: publicationPreflightRequestSchema,
  },
  {
    name: "PublicationPreflightResponse",
    audience: "admin-http",
    schema: publicationPreflightResponseSchema,
  },
  {
    name: "PublicationPreflightContext",
    audience: "internal",
    schema: publicationPreflightContextSchema,
  },
  {
    name: "PublicationPreflightContextResponse",
    audience: "internal",
    schema: publicationPreflightContextResponseSchema,
  },
  {
    name: "BaseContentReviewContext",
    audience: "internal",
    schema: baseContentReviewContextSchema,
  },
  {
    name: "BaseContentReviewReadCommand",
    audience: "internal",
    schema: baseContentReviewReadCommandSchema,
  },
  {
    name: "BaseContentReviewResponse",
    audience: "admin-http",
    schema: baseContentReviewResponseSchema,
  },
  {
    name: "AppendBaseContentReviewCommand",
    audience: "internal",
    schema: appendBaseContentReviewCommandSchema,
  },
  {
    name: "BaseContentPreviewResponse",
    audience: "admin-http",
    schema: baseContentPreviewResponseSchema,
  },
  {
    name: "IssueBaseContentPreviewCommand",
    audience: "internal",
    schema: issueBaseContentPreviewCommandSchema,
  },
  {
    name: "ReadBaseContentPreviewCommand",
    audience: "internal",
    schema: readBaseContentPreviewCommandSchema,
  },
  {
    name: "RevokeBaseContentPreviewCommand",
    audience: "internal",
    schema: revokeBaseContentPreviewCommandSchema,
  },
  {
    name: "BaseContentPreviewGrantResponse",
    audience: "internal",
    schema: baseContentPreviewGrantResponseSchema,
  },
  {
    name: "BaseContentPreviewRequest",
    audience: "admin-http",
    schema: baseContentPreviewRequestSchema,
  },
  {
    name: "BaseContentCommand",
    audience: "internal",
    schema: baseContentCommandSchema,
  },
  {
    name: "BaseContentRequest",
    audience: "internal",
    schema: baseContentRequestSchema,
  },
  {
    name: "BaseContentResponse",
    audience: "admin-http",
    schema: baseContentResponseSchema,
  },
  {
    name: "MediaSourceInspectionCommand",
    audience: "internal",
    schema: mediaSourceInspectionCommandSchema,
  },
  {
    name: "MediaSourceInspectionReceipt",
    audience: "internal",
    schema: mediaSourceInspectionReceiptSchema,
  },
  {
    name: "MediaSourceInspectionResponse",
    audience: "internal",
    schema: mediaSourceInspectionResponseSchema,
  },
  {
    name: "AdminResourceAuthorizationCommand",
    audience: "internal",
    schema: adminResourceAuthorizationCommandSchema,
  },
  {
    name: "AdminResourceCommand",
    audience: "internal",
    schema: adminResourceCommandSchema,
  },
  {
    name: "AdminResourceRequest",
    audience: "internal",
    schema: adminResourceRequestSchema,
  },
  {
    name: "ResourcePolicySnapshot",
    audience: "internal",
    schema: resourcePolicySnapshotSchema,
  },
  {
    name: "ResourcePolicyResponse",
    audience: "internal",
    schema: resourcePolicyResponseSchema,
  },
  {
    name: "MediaUploadTicket",
    audience: "internal",
    schema: mediaUploadTicketSchema,
  },
  {
    name: "MediaUploadTicketResponse",
    audience: "internal",
    schema: mediaUploadTicketResponseSchema,
  },
  {
    name: "MediaUploadSnapshot",
    audience: "internal",
    schema: mediaUploadSnapshotSchema,
  },
  {
    name: "MediaUploadResponse",
    audience: "internal",
    schema: mediaUploadResponseSchema,
  },
  {
    name: "MediaUploadGrantResponse",
    audience: "admin-http",
    schema: mediaUploadGrantResponseSchema,
  },
  {
    name: "ResourceMediaSnapshot",
    audience: "internal",
    schema: resourceMediaSnapshotSchema,
  },
  {
    name: "ResourceMediaResponse",
    audience: "internal",
    schema: resourceMediaResponseSchema,
  },
  {
    name: "ResourceMediaJobSnapshot",
    audience: "internal",
    schema: resourceMediaJobSnapshotSchema,
  },
  {
    name: "ResourceMediaJobResponse",
    audience: "internal",
    schema: resourceMediaJobResponseSchema,
  },
  {
    name: "AdminResourceResponse",
    audience: "admin-http",
    schema: adminResourceResponseSchema,
  },
  {
    name: "ResourcePolicyReadCommand",
    audience: "internal",
    schema: resourcePolicyReadCommandSchema,
  },
  {
    name: "ResourcePolicyRegisterCommand",
    audience: "internal",
    schema: resourcePolicyRegisterCommandSchema,
  },
  {
    name: "MediaUploadReserveCommand",
    audience: "internal",
    schema: mediaUploadReserveCommandSchema,
  },
  {
    name: "MediaUploadReadCommand",
    audience: "internal",
    schema: mediaUploadReadCommandSchema,
  },
  {
    name: "MediaUploadRegisterCommand",
    audience: "internal",
    schema: mediaUploadRegisterCommandSchema,
  },
  {
    name: "ResourceMediaReadCommand",
    audience: "internal",
    schema: resourceMediaReadCommandSchema,
  },
  {
    name: "MediaRightsSetCommand",
    audience: "internal",
    schema: mediaRightsSetCommandSchema,
  },
  {
    name: "ResourceMediaEnqueueCommand",
    audience: "internal",
    schema: resourceMediaEnqueueCommandSchema,
  },
  {
    name: "ResourceMediaJobReadCommand",
    audience: "internal",
    schema: resourceMediaJobReadCommandSchema,
  },
  {
    name: "ResourceMediaRetryCommand",
    audience: "internal",
    schema: resourceMediaRetryCommandSchema,
  },
  {
    name: "PublicationManifestRevision",
    audience: "internal",
    schema: publicationManifestRevisionSchema,
  },
  {
    name: "PublicationManifestAsset",
    audience: "internal",
    schema: publicationManifestAssetSchema,
  },
  {
    name: "PublicationManifestVariant",
    audience: "internal",
    schema: publicationManifestVariantSchema,
  },
  {
    name: "PublicationManifest",
    audience: "internal",
    schema: publicationManifestSchema,
  },
  {
    name: "PublicationManifestRecord",
    audience: "internal",
    schema: publicationManifestRecordSchema,
  },
  {
    name: "PublishedContentReadCommand",
    audience: "public-http",
    schema: publishedContentReadCommandSchema,
  },
  {
    name: "PublishedContentResponse",
    audience: "public-http",
    schema: publishedContentResponseSchema,
  },
  {
    name: "PublishedContentContext",
    audience: "internal",
    schema: publishedContentContextSchema,
  },
  {
    name: "PublishedContentContextResponse",
    audience: "internal",
    schema: publishedContentContextResponseSchema,
  },
  {
    name: "PublishedContentFailure",
    audience: "public-http",
    schema: publishedContentFailureSchema,
  },
  {
    name: "PublicationAuthorizationCommand",
    audience: "internal",
    schema: publicationAuthorizationCommandSchema,
  },
  {
    name: "PublicationRevisionCommand",
    audience: "internal",
    schema: publicationRevisionCommandSchema,
  },
  {
    name: "PublicationStatusCommand",
    audience: "internal",
    schema: publicationStatusCommandSchema,
  },
  {
    name: "PublicationRetryCommand",
    audience: "internal",
    schema: publicationRetryCommandSchema,
  },
  {
    name: "PublicationRuntimeCommand",
    audience: "admin-http",
    schema: publicationRuntimeCommandSchema,
  },
  {
    name: "PublicationRuntimeRequest",
    audience: "admin-http",
    schema: publicationRuntimeRequestSchema,
  },
  {
    name: "PublicationRuntimeMutation",
    audience: "internal",
    schema: publicationRuntimeMutationSchema,
  },
  {
    name: "PublicationPurgeRetryResult",
    audience: "internal",
    schema: publicationPurgeRetryResultSchema,
  },
  {
    name: "PublicationStatusResponse",
    audience: "admin-http",
    schema: publicationStatusResponseSchema,
  },
  {
    name: "PublicationRuntimeResponse",
    audience: "admin-http",
    schema: publicationRuntimeResponseSchema,
  },
  {
    name: "PublicationRuntimeContext",
    audience: "internal",
    schema: publicationRuntimeContextSchema,
  },
  {
    name: "PublicationRuntimeContextResponse",
    audience: "internal",
    schema: publicationRuntimeContextResponseSchema,
  },
  {
    name: "PublicationRuntimeWriteCommand",
    audience: "internal",
    schema: publicationRuntimeWriteCommandSchema,
  },
  {
    name: "PublicationRuntimeReceiptReadCommand",
    audience: "internal",
    schema: publicationRuntimeReceiptReadCommandSchema,
  },
  {
    name: "PublicationRuntimeRetryWriteCommand",
    audience: "internal",
    schema: publicationRuntimeRetryWriteCommandSchema,
  },
  {
    name: "PublicationPurgeJob",
    audience: "internal",
    schema: publicationPurgeJobSchema,
  },
  {
    name: "PublicationPurgeClaimCommand",
    audience: "internal",
    schema: publicationPurgeClaimCommandSchema,
  },
  {
    name: "PublicationPurgeClaim",
    audience: "internal",
    schema: publicationPurgeClaimSchema,
  },
  {
    name: "PublicationPurgeClaimResponse",
    audience: "internal",
    schema: publicationPurgeClaimResponseSchema,
  },
  {
    name: "PublicationPurgeRecordCommand",
    audience: "internal",
    schema: publicationPurgeRecordCommandSchema,
  },
  {
    name: "PublicationPurgeRecordResponse",
    audience: "internal",
    schema: publicationPurgeRecordResponseSchema,
  },
  {
    name: "PublicationPurgeRunResult",
    audience: "internal",
    schema: publicationPurgeRunResultSchema,
  },
  {
    name: "AdminSessionCommand",
    audience: "admin-http",
    schema: adminSessionCommandSchema,
  },
  {
    name: "AdminSessionRequest",
    audience: "admin-http",
    schema: adminSessionRequestSchema,
  },
  {
    name: "AdminSessionResponse",
    audience: "admin-http",
    schema: adminSessionResponseSchema,
  },
  {
    name: "AdminSessionBootstrapResponse",
    audience: "admin-http",
    schema: adminSessionBootstrapResponseSchema,
  },
  {
    name: "AdminSessionReadCommand",
    audience: "internal",
    schema: adminSessionReadCommandSchema,
  },
  {
    name: "AdminCatalogCommand",
    audience: "admin-http",
    schema: adminCatalogCommandSchema,
  },
  {
    name: "AdminCatalogRequest",
    audience: "admin-http",
    schema: adminCatalogRequestSchema,
  },
  {
    name: "AdminCatalogOwner",
    audience: "admin-http",
    schema: adminCatalogOwnerSchema,
  },
  {
    name: "AdminCatalogMutation",
    audience: "admin-http",
    schema: adminCatalogMutationSchema,
  },
  {
    name: "AdminCatalogResponse",
    audience: "admin-http",
    schema: adminCatalogResponseSchema,
  },
  {
    name: "AdminCatalogReadCommand",
    audience: "internal",
    schema: adminCatalogReadCommandSchema,
  },
  {
    name: "AdminCatalogWriteCommand",
    audience: "internal",
    schema: adminCatalogWriteCommandSchema,
  },
  {
    name: "AdminCatalogReceiptReadCommand",
    audience: "internal",
    schema: adminCatalogReceiptReadCommandSchema,
  },
  {
    name: "IdolHandleResolutionCommand",
    audience: "internal",
    schema: idolHandleResolutionCommandSchema,
  },
  {
    name: "IdolHandleResolution",
    audience: "internal",
    schema: idolHandleResolutionSchema,
  },
  {
    name: "TranslationWorkspaceCommand",
    audience: "admin-http",
    schema: translationWorkspaceCommandSchema,
  },
  {
    name: "TranslationWorkspaceRequest",
    audience: "admin-http",
    schema: translationWorkspaceRequestSchema,
  },
  {
    name: "TranslationWorkspaceResponse",
    audience: "admin-http",
    schema: translationWorkspaceResponseSchema,
  },
  {
    name: "TranslationWorkspaceContext",
    audience: "internal",
    schema: translationWorkspaceContextSchema,
  },
  {
    name: "TranslationWorkspaceContextResponse",
    audience: "internal",
    schema: translationWorkspaceContextResponseSchema,
  },
  {
    name: "TranslationTransferPackage",
    audience: "admin-http",
    schema: translationTransferPackageSchema,
  },
  {
    name: "TranslationTransferCommand",
    audience: "admin-http",
    schema: translationTransferCommandSchema,
  },
  {
    name: "TranslationTransferRequest",
    audience: "admin-http",
    schema: translationTransferRequestSchema,
  },
  {
    name: "TranslationTransferResponse",
    audience: "admin-http",
    schema: translationTransferResponseSchema,
  },
  {
    name: "TranslationExportReceipt",
    audience: "internal",
    schema: translationExportReceiptSchema,
  },
  {
    name: "TranslationExportReceiptResponse",
    audience: "internal",
    schema: translationExportReceiptResponseSchema,
  },
  {
    name: "TranslationExportCreateCommand",
    audience: "internal",
    schema: translationExportCreateCommandSchema,
  },
  {
    name: "TranslationExportReadCommand",
    audience: "internal",
    schema: translationExportReadCommandSchema,
  },
  {
    name: "TranslationImportRecordCommand",
    audience: "internal",
    schema: translationImportRecordCommandSchema,
  },
  {
    name: "AdminPreviewMediaRequest",
    audience: "admin-http",
    schema: adminPreviewMediaRequestSchema,
  },
  {
    name: "AdminPreviewMediaResponse",
    audience: "admin-http",
    schema: adminPreviewMediaResponseSchema,
  },
  {
    name: "AdminPreviewMediaContext",
    audience: "internal",
    schema: adminPreviewMediaContextSchema,
  },
  {
    name: "AdminPreviewMediaContextResponse",
    audience: "internal",
    schema: adminPreviewMediaContextResponseSchema,
  },
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
