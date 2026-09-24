import {
  rumIntakeSchema,
  rumObservationSchema,
  rumReportSchema,
  rumReportV2Schema,
} from "./rum.js";
import * as adminPaymentConfiguration from "./admin-payment-configuration.js";
import {
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
} from "./gift-browse.js";
import {
  giftBrowseReadCommandSchema,
  giftBrowseSnapshotSchema,
} from "./gift-browse-internal.js";
import * as adminExceptions from "./admin-exceptions.js";
import * as adminExceptionsPersistence from "./admin-exceptions-persistence.js";
import * as adminPaymentConfigurationPersistence from "./admin-payment-configuration-persistence.js";
import * as paymentConfigurationValidation from "./payment-configuration-validation.js";
import * as financeEvidence from "./finance-evidence.js";
import * as adminFinance from "./admin-finance.js";
import * as adminFinancePersistence from "./admin-finance-persistence.js";
import * as paymentRollout from "./payment-rollout.js";
import * as paymentHealth from "./payment-health.js";
import * as adminOrderNoteKey from "./admin-order-note-key.js";
import * as adminOrdersPersistence from "./admin-orders-persistence.js";
import * as adminOrders from "./admin-orders.js";
import * as adminAccess from "./admin-access.js";
import * as orderNotification from "./order-notification.js";
import * as orderAccess from "./order-access.js";
import * as orderPaymentApplication from "./order-payment-application.js";
import * as paymentRuntimeInternal from "./payment-runtime-internal.js";
import * as paymentRuntime from "./payment-runtime.js";
import * as paymentRuntimeConfig from "./payment-runtime-config.js";
import * as paymentConnector from "./payment-connector.js";
import * as paymentStablecoin from "./payment-stablecoin.js";
import {
  checkoutTranslationSnapshotSchema,
  checkoutMediaSnapshotSchema,
  checkoutPolicyAcceptanceSchema,
  checkoutPreflightValidateCommandSchema,
  checkoutPreflightCreateCommandSchema,
  checkoutPreflightReadCommandSchema,
  checkoutPreflightCommandSchema,
  checkoutPreflightFailureSchema,
  checkoutPreflightValidateRequestSchema,
  checkoutPreflightCreateRequestSchema,
  checkoutPreflightReadRequestSchema,
} from "./checkout-preflight.js";
import {
  checkoutPreflightLoadCurrentCommandSchema,
  checkoutPreflightLineFactsSchema,
  checkoutPreflightPolicyFactsSchema,
  checkoutPreflightInventoryFactsSchema,
  checkoutPreflightConsentSchema,
  checkoutPreflightCurrentSchema,
  checkoutPreflightObservationSchema,
  checkoutPreflightSaveCommandSchema,
  checkoutPreflightFindCommandSchema,
  checkoutPreflightReadSessionCommandSchema,
  checkoutEncryptedContactSchema,
  checkoutPreflightCommitCommandSchema,
  checkoutPreflightReceiptSchema,
  checkoutPreflightSessionRecordSchema,
} from "./checkout-preflight-internal.js";
import {
  checkoutPreflightPublicLineSchema,
  checkoutPreflightPublicPolicySchema,
  checkoutPreflightViewSchema,
  checkoutSessionViewSchema,
  checkoutPreflightResponseSchema,
} from "./checkout-preflight-public.js";
import {
  checkoutInventoryAssignmentSchema,
  checkoutInventorySelectionSchema,
  checkoutInventoryPlanCommandSchema,
  checkoutInventoryPlanSchema,
} from "./checkout-preflight-inventory.js";
import {
  cartEditUpdateCommandSchema,
  cartEditRemoveCommandSchema,
  cartEditorReadCommandSchema,
  cartEditCommandSchema,
  cartEditFailureSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  cartRuntimeCurrentResponseSchema,
} from "./cart-edit.js";
import {
  cartEditLoadItemCommandSchema,
  cartEditItemSnapshotSchema,
  cartEditLoadPrivateCommandSchema,
  cartEditPrivateSnapshotSchema,
  cartEditConfirmPrivateCommandSchema,
  cartEditWriteMutationCommandSchema,
  cartEditFindMutationReceiptCommandSchema,
  cartEditMutationReceiptSchema,
} from "./cart-edit-internal.js";
import {
  cartEditUpdateRequestSchema,
  cartEditRemoveRequestSchema,
  cartEditorReadRequestSchema,
} from "./cart-edit-http.js";
import { cartEditEventSchema } from "./cart-edit-events.js";
import {
  cartRuntimeInitializeCommandSchema,
  cartRuntimeReadCommandSchema,
  cartRuntimeAddCommandSchema,
  cartRuntimeCommandSchema,
  cartRuntimeFailureSchema,
  cartRuntimeAccessSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeItemRecordSchema,
  cartRuntimeInitializeRecordCommandSchema,
  cartRuntimeCredentialCommandSchema,
  cartRuntimeListItemsCommandSchema,
  cartRuntimeResolveGiftCommandSchema,
  cartRuntimeResolvedGiftSchema,
  cartRuntimeAppendItemCommandSchema,
  cartRuntimeFindReceiptCommandSchema,
  cartRuntimeReceiptSchema,
  cartRuntimeItemViewSchema,
  cartRuntimeViewSchema,
  cartRuntimeResponseSchema,
  cartRuntimeAddDecisionInputSchema,
  cartRuntimeAddDecisionSchema,
  cartRuntimeProjectionInputSchema,
} from "./cart-runtime.js";
import { cartRuntimeRequestContextSchema } from "./cart-runtime-context.js";
import {
  cartRuntimeInitializeRequestSchema,
  cartRuntimeAddRequestSchema,
} from "./cart-runtime-http.js";
import {
  generateSupportIntentKeyCommandSchema,
  generateSupportIntentKeyResponseSchema,
} from "./support-intent-key.js";
import {
  managementCenterPriceSchema,
  managementCenterInventorySchema,
  managementCenterIntentSchema,
  managementCenterFailureSchema,
  managementCenterOperationSchema,
  managementCenterCommandSchema,
  managementCenterRequestSchema,
  managementCenterListItemSchema,
  managementCenterResponseSchema,
} from "./management-center.js";
import {
  managementCenterAuthorizationSchema,
  managementCenterPreparedMediaSchema,
  managementCenterCheckpointSchema,
  managementCenterClaimSchema,
} from "./management-center-internal.js";
import {
  singleSourceLocaleContextSchema,
  contentLocaleContextSchema,
} from "./content-provenance.js";
import {
  dailyMediaMetadataDocumentSchema,
  dailyPublicationDocumentSchema,
  dailyPublicationManifestSchema,
  dailyPublicationCurrentMediaSchema,
  dailyPublicationContextSchema,
} from "./daily-publication.js";
import {
  legacyIdolDirectoryRecordSchema,
  legacyGiftDirectoryRecordSchema,
  legacyIdolDirectorySnapshotSchema,
  legacyGiftDirectorySnapshotSchema,
} from "./catalog-directory.js";
import {
  legacyPublishedContentContextSchema,
  legacyPublishedContentContextResponseSchema,
} from "./published-content.js";
import {
  legacyPublishedGiftCommerceContextResponseSchema,
  legacyStorefrontHomepageContextResponseSchema,
  legacyStorefrontGiftContextResponseSchema,
} from "./legacy-public-contexts.js";
import {
  legacyPublishedContentResponseSchema,
  legacyIdolDirectoryResponseSchema,
  legacyGiftDirectoryResponseSchema,
  legacyPublishedGiftCommerceResponseSchema,
  legacyStorefrontHomepageResponseSchema,
  legacyStorefrontGiftResponseSchema,
} from "./legacy-public-responses.js";
import {
  legacyPublishedIdolViewSchema,
  legacyPublishedGiftViewSchema,
} from "./catalog-content.js";
import { legacyPublishedMediaViewSchema } from "./media-content.js";
import { legacyPublishedHomepageViewSchema } from "./content-models.js";
import {
  storefrontContextReadCommandSchema,
  storefrontContextResponseSchema,
  storefrontGiftReadCommandSchema,
  storefrontGiftResponseSchema,
  storefrontGiftContextResponseSchema,
} from "./storefront-commerce.js";
import {
  storefrontHomepageReadCommandSchema,
  storefrontHomepageContextResponseSchema,
  storefrontHomepageResponseSchema,
} from "./storefront-homepage.js";
import {
  publishedGiftCommerceReadCommandSchema,
  publishedGiftCommerceResponseSchema,
  publishedGiftCommerceContextResponseSchema,
} from "./published-gift-commerce.js";
import {
  giftCommerceFailureSchema,
  giftCommerceAuthorizationCommandSchema,
  giftCommerceAuthorizationResponseSchema,
  giftCommerceAccessContextCommandSchema,
  giftCommerceAccessContextResponseSchema,
  giftCommerceContentAuthoringSchema,
  giftCommerceReadCommandSchema,
  giftCommerceMutationCommandSchema,
  giftCommerceCommandSchema,
  giftCommerceRequestSchema,
  giftCommerceWriteCommandSchema,
  giftCommerceReceiptReadCommandSchema,
  giftCommerceVariantSchema,
  giftCommerceGiftSchema,
  giftCommercePriceBookSchema,
  giftCommercePriceSchema,
  giftCommerceRawContextSchema,
  giftCommerceContextResponseSchema,
  giftCommerceReadResponseSchema,
  giftCommerceMutationSchema,
  giftCommerceResponseSchema,
} from "./gift-commerce.js";
import {
  giftRevisionProfileSchema,
  giftPublicationProfileSchema,
} from "./gift-commerce-profile.js";
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
  "AdminOrdersPermission",
  "AdminOrdersListItem",
  "AdminOrdersLine",
  "AdminOrdersNoteMetadata",
  "AdminOrdersNotification",
  "AdminOrdersPrincipal",
  "AdminOrdersNoteEnvelope",

  "OrderNotificationUrl",
  "CheckoutPolicyAcceptance",
  "CheckoutEncryptedContact",
  "CheckoutInventoryAssignment",
  "ManagementCenterPrice",
  "ManagementCenterInventory",
  "ManagementCenterIntent",
  "ManagementCenterOperation",
  "ManagementCenterListItem",
  "ManagementCenterCheckpoint",
  "ManagementCenterPreparedMedia",
  "DailyPublicationCurrentMedia",

  "SupportedLocale",
  "TranslationSnapshotRef",
  "MediaSnapshot",
]);

const registrations = [
  { name: "RumIntake", audience: "public-http", schema: rumIntakeSchema },
  {
    name: "RumObservation",
    audience: "internal",
    schema: rumObservationSchema,
  },
  { name: "RumReport", audience: "internal", schema: rumReportSchema },
  { name: "RumReportV2", audience: "internal", schema: rumReportV2Schema },
  {
    name: "GiftBrowseQuery",
    audience: "public-http",
    schema: giftBrowseQuerySchema,
  },
  {
    name: "GiftBrowseResponse",
    audience: "public-http",
    schema: giftBrowseResponseSchema,
  },
  {
    name: "GiftBrowseReadCommand",
    audience: "internal",
    schema: giftBrowseReadCommandSchema,
  },
  {
    name: "GiftBrowseSnapshot",
    audience: "internal",
    schema: giftBrowseSnapshotSchema,
  },
  {
    name: "AdminExceptionsRunResult",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsRunResultSchema,
  },
  {
    name: "AdminExceptionsCommand",
    audience: "admin-http",
    schema: adminExceptions.adminExceptionsCommandSchema,
  },
  {
    name: "AdminExceptionsRequest",
    audience: "admin-http",
    schema: adminExceptions.adminExceptionsRequestSchema,
  },
  {
    name: "AdminExceptionsResponse",
    audience: "admin-http",
    schema: adminExceptions.adminExceptionsResponseSchema,
  },
  {
    name: "AdminExceptionsFailure",
    audience: "admin-http",
    schema: adminExceptions.adminExceptionsFailureSchema,
  },
  {
    name: "AdminExceptionsStoreRequest",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsStoreRequestSchema,
  },
  {
    name: "AdminExceptionsClaimRequest",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsClaimRequestSchema,
  },
  {
    name: "AdminExceptionsClaim",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsClaimSchema,
  },
  {
    name: "AdminExceptionsSettleCommand",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsSettleCommandSchema,
  },
  {
    name: "AdminExceptionsSettleResult",
    audience: "internal",
    schema: adminExceptionsPersistence.adminExceptionsSettleResultSchema,
  },
  {
    name: "PaymentConfigurationDocument",
    audience: "internal",
    schema: adminPaymentConfiguration.paymentConfigurationDocumentSchema,
  },
  {
    name: "AdminPaymentConfigurationCommand",
    audience: "admin-http",
    schema: adminPaymentConfiguration.adminPaymentConfigurationCommandSchema,
  },
  {
    name: "AdminPaymentConfigurationRequest",
    audience: "admin-http",
    schema: adminPaymentConfiguration.adminPaymentConfigurationRequestSchema,
  },
  {
    name: "AdminPaymentConfigurationResponse",
    audience: "admin-http",
    schema: adminPaymentConfiguration.adminPaymentConfigurationResponseSchema,
  },
  {
    name: "AdminPaymentConfigurationFailure",
    audience: "admin-http",
    schema: adminPaymentConfiguration.adminPaymentConfigurationFailureSchema,
  },
  {
    name: "AdminPaymentConfigurationStoreRequest",
    audience: "internal",
    schema:
      adminPaymentConfigurationPersistence.adminPaymentConfigurationStoreRequestSchema,
  },
  {
    name: "PaymentConfigurationPublishedProjection",
    audience: "internal",
    schema:
      adminPaymentConfigurationPersistence.paymentConfigurationPublishedProjectionSchema,
  },
  {
    name: "PaymentConfigurationValidationInput",
    audience: "internal",
    schema:
      paymentConfigurationValidation.paymentConfigurationValidationInputSchema,
  },
  {
    name: "PaymentConfigurationValidationResult",
    audience: "internal",
    schema:
      paymentConfigurationValidation.paymentConfigurationValidationResultSchema,
  },
  {
    name: "PaymentConfigurationDiffInput",
    audience: "internal",
    schema: paymentConfigurationValidation.paymentConfigurationDiffInputSchema,
  },
  {
    name: "PaymentConfigurationDiffResult",
    audience: "internal",
    schema: paymentConfigurationValidation.paymentConfigurationDiffResultSchema,
  },
  {
    name: "FinanceEvidenceInput",
    audience: "internal",
    schema: financeEvidence.financeEvidenceInputSchema,
  },
  {
    name: "FinanceEvidenceDecision",
    audience: "internal",
    schema: financeEvidence.financeEvidenceDecisionSchema,
  },
  {
    name: "FinanceDisputeProjectionInput",
    audience: "internal",
    schema: financeEvidence.financeDisputeProjectionInputSchema,
  },
  {
    name: "FinanceDisputeProjection",
    audience: "internal",
    schema: financeEvidence.financeDisputeProjectionSchema,
  },
  {
    name: "AdminFinanceFailure",
    audience: "admin-http",
    schema: adminFinance.adminFinanceFailureSchema,
  },
  {
    name: "AdminFinanceCommand",
    audience: "admin-http",
    schema: adminFinance.adminFinanceCommandSchema,
  },
  {
    name: "AdminFinanceRequest",
    audience: "admin-http",
    schema: adminFinance.adminFinanceRequestSchema,
  },
  {
    name: "AdminFinanceMutationResponse",
    audience: "admin-http",
    schema: adminFinance.adminFinanceMutationResponseSchema,
  },
  {
    name: "AdminFinanceResponse",
    audience: "admin-http",
    schema: adminFinance.adminFinanceResponseSchema,
  },
  {
    name: "AdminFinanceStoreRequest",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceStoreRequestSchema,
  },
  {
    name: "AdminFinanceProviderCommand",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceProviderCommandSchema,
  },
  {
    name: "AdminFinanceClaimRequest",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceClaimRequestSchema,
  },
  {
    name: "AdminFinanceClaim",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceClaimSchema,
  },
  {
    name: "AdminFinanceSettleCommand",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceSettleCommandSchema,
  },
  {
    name: "AdminFinanceSettleResult",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceSettleResultSchema,
  },
  {
    name: "AdminFinanceApplyCommand",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceApplyCommandSchema,
  },
  {
    name: "AdminFinanceApplyResult",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceApplyResultSchema,
  },
  {
    name: "AdminFinanceListPendingCommand",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceListPendingCommandSchema,
  },
  {
    name: "AdminFinancePendingEvents",
    audience: "internal",
    schema: adminFinancePersistence.adminFinancePendingEventsSchema,
  },
  {
    name: "AdminFinanceRunResult",
    audience: "internal",
    schema: adminFinancePersistence.adminFinanceRunResultSchema,
  },
  {
    name: "AdminOrdersPermission",
    audience: "admin-http",
    schema: adminOrders.adminOrdersPermissionSchema,
  },
  {
    name: "AdminOrdersFailure",
    audience: "admin-http",
    schema: adminOrders.adminOrdersFailureSchema,
  },
  {
    name: "AdminOrdersCommand",
    audience: "admin-http",
    schema: adminOrders.adminOrdersCommandSchema,
  },
  {
    name: "AdminOrdersRequest",
    audience: "admin-http",
    schema: adminOrders.adminOrdersRequestSchema,
  },
  {
    name: "AdminOrdersListItem",
    audience: "admin-http",
    schema: adminOrders.adminOrdersListItemSchema,
  },
  {
    name: "AdminOrdersLine",
    audience: "admin-http",
    schema: adminOrders.adminOrdersLineSchema,
  },
  {
    name: "AdminOrdersNoteMetadata",
    audience: "admin-http",
    schema: adminOrders.adminOrdersNoteMetadataSchema,
  },
  {
    name: "AdminOrdersNotification",
    audience: "admin-http",
    schema: adminOrders.adminOrdersNotificationSchema,
  },
  {
    name: "AdminOrdersMutationResponse",
    audience: "admin-http",
    schema: adminOrders.adminOrdersMutationResponseSchema,
  },
  {
    name: "AdminOrdersResponse",
    audience: "admin-http",
    schema: adminOrders.adminOrdersResponseSchema,
  },
  {
    name: "AdminOrdersPrivateResponse",
    audience: "admin-http",
    schema: adminOrders.adminOrdersPrivateResponseSchema,
  },
  {
    name: "AdminOrdersAccess",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersAccessSchema,
  },
  {
    name: "AdminOrdersPrincipal",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersPrincipalSchema,
  },
  {
    name: "AdminOrdersNoteEnvelope",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersNoteEnvelopeSchema,
  },
  {
    name: "AdminOrdersStoreCommand",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersStoreCommandSchema,
  },
  {
    name: "AdminOrdersStoreRequest",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersStoreRequestSchema,
  },
  {
    name: "AdminOrdersPrivateSnapshot",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersPrivateSnapshotSchema,
  },
  {
    name: "AdminOrdersConfirmPrivate",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersConfirmPrivateSchema,
  },
  {
    name: "AdminOrdersPrivateConfirmation",
    audience: "internal",
    schema: adminOrdersPersistence.adminOrdersPrivateConfirmationSchema,
  },
  {
    name: "AdminOrderNoteEncryptCommand",
    audience: "internal",
    schema: adminOrderNoteKey.adminOrderNoteEncryptCommandSchema,
  },
  {
    name: "AdminOrderNoteDecryptCommand",
    audience: "internal",
    schema: adminOrderNoteKey.adminOrderNoteDecryptCommandSchema,
  },
  {
    name: "CommerceExpiryRunResult",
    audience: "internal",
    schema: orderNotification.commerceExpiryRunResultSchema,
  },
  {
    name: "OrderNotificationBaseVariables",
    audience: "internal",
    schema: orderNotification.orderNotificationBaseVariablesSchema,
  },
  {
    name: "OrderNotificationUrl",
    audience: "internal",
    schema: orderNotification.orderNotificationUrlSchema,
  },
  {
    name: "OrderNotificationVariables",
    audience: "internal",
    schema: orderNotification.orderNotificationVariablesSchema,
  },
  {
    name: "OrderNotificationTemplateSelection",
    audience: "internal",
    schema: orderNotification.orderNotificationTemplateSelectionSchema,
  },
  {
    name: "OrderNotificationRenderCommand",
    audience: "internal",
    schema: orderNotification.orderNotificationRenderCommandSchema,
  },
  {
    name: "NotificationEmailDispatch",
    audience: "internal",
    schema: orderNotification.notificationEmailDispatchSchema,
  },
  {
    name: "NotificationGatewayProfile",
    audience: "internal",
    schema: orderNotification.notificationGatewayProfileSchema,
  },
  {
    name: "NotificationGatewayReceipt",
    audience: "internal",
    schema: orderNotification.notificationGatewayReceiptSchema,
  },
  {
    name: "NotificationTemplateReview",
    audience: "internal",
    schema: orderNotification.notificationTemplateReviewSchema,
  },
  {
    name: "NotificationSourceCommand",
    audience: "internal",
    schema: orderNotification.notificationSourceCommandSchema,
  },
  {
    name: "NotificationSourceResult",
    audience: "internal",
    schema: orderNotification.notificationSourceResultSchema,
  },
  {
    name: "NotificationRequestCommand",
    audience: "internal",
    schema: orderNotification.notificationRequestCommandSchema,
  },
  {
    name: "NotificationRequestResult",
    audience: "internal",
    schema: orderNotification.notificationRequestResultSchema,
  },
  {
    name: "NotificationLeaseCommand",
    audience: "internal",
    schema: orderNotification.notificationLeaseCommandSchema,
  },
  {
    name: "NotificationClaimCommand",
    audience: "internal",
    schema: orderNotification.notificationClaimCommandSchema,
  },
  {
    name: "NotificationDeliveryPlan",
    audience: "internal",
    schema: orderNotification.notificationDeliveryPlanSchema,
  },
  {
    name: "NotificationClaimResult",
    audience: "internal",
    schema: orderNotification.notificationClaimResultSchema,
  },
  {
    name: "NotificationAttachLinkCommand",
    audience: "internal",
    schema: orderNotification.notificationAttachLinkCommandSchema,
  },
  {
    name: "NotificationAttachLinkResult",
    audience: "internal",
    schema: orderNotification.notificationAttachLinkResultSchema,
  },
  {
    name: "NotificationRecipientResult",
    audience: "internal",
    schema: orderNotification.notificationRecipientResultSchema,
  },
  {
    name: "NotificationConfirmSendCommand",
    audience: "internal",
    schema: orderNotification.notificationConfirmSendCommandSchema,
  },
  {
    name: "NotificationConfirmSendResult",
    audience: "internal",
    schema: orderNotification.notificationConfirmSendResultSchema,
  },
  {
    name: "NotificationFinishCommand",
    audience: "internal",
    schema: orderNotification.notificationFinishCommandSchema,
  },
  {
    name: "NotificationFinishResult",
    audience: "internal",
    schema: orderNotification.notificationFinishResultSchema,
  },
  {
    name: "NotificationListPendingCommand",
    audience: "internal",
    schema: orderNotification.notificationListPendingCommandSchema,
  },
  {
    name: "NotificationListPendingResult",
    audience: "internal",
    schema: orderNotification.notificationListPendingResultSchema,
  },
  {
    name: "NotificationRunResult",
    audience: "internal",
    schema: orderNotification.notificationRunResultSchema,
  },
  {
    name: "NotificationRuntimeConfiguration",
    audience: "internal",
    schema: orderNotification.notificationRuntimeConfigurationSchema,
  },
  {
    name: "CommerceExpiryListCommand",
    audience: "internal",
    schema: orderNotification.commerceExpiryListCommandSchema,
  },
  {
    name: "CommerceExpiryListResult",
    audience: "internal",
    schema: orderNotification.commerceExpiryListResultSchema,
  },
  {
    name: "CommerceExpiryCommand",
    audience: "internal",
    schema: orderNotification.commerceExpiryCommandSchema,
  },
  {
    name: "CommerceExpiryResult",
    audience: "internal",
    schema: orderNotification.commerceExpiryResultSchema,
  },
  {
    name: "OrderAccessCredential",
    audience: "internal",
    schema: orderAccess.orderAccessCredentialSchema,
  },
  {
    name: "OrderAccessIssueCommand",
    audience: "internal",
    schema: orderAccess.orderAccessIssueCommandSchema,
  },
  {
    name: "OrderAccessExchangeCommand",
    audience: "internal",
    schema: orderAccess.orderAccessExchangeCommandSchema,
  },
  {
    name: "OrderAccessBootstrapCommand",
    audience: "internal",
    schema: orderAccess.orderAccessBootstrapCommandSchema,
  },
  {
    name: "OrderAccessReadCommand",
    audience: "internal",
    schema: orderAccess.orderAccessReadCommandSchema,
  },
  {
    name: "OrderAccessRevokeCommand",
    audience: "internal",
    schema: orderAccess.orderAccessRevokeCommandSchema,
  },
  {
    name: "OrderAccessGrant",
    audience: "public-http",
    schema: orderAccess.orderAccessGrantSchema,
  },
  {
    name: "OrderAccessRevoked",
    audience: "public-http",
    schema: orderAccess.orderAccessRevokedSchema,
  },
  {
    name: "OrderAccessLocale",
    audience: "public-http",
    schema: orderAccess.orderAccessLocaleSchema,
  },
  {
    name: "OrderAccessItem",
    audience: "public-http",
    schema: orderAccess.orderAccessItemSchema,
  },
  {
    name: "OrderAccessDetail",
    audience: "public-http",
    schema: orderAccess.orderAccessDetailSchema,
  },
  {
    name: "OrderAccessResponse",
    audience: "public-http",
    schema: orderAccess.orderAccessResponseSchema,
  },
  {
    name: "OrderAccessRateCommand",
    audience: "internal",
    schema: orderAccess.orderAccessRateCommandSchema,
  },
  {
    name: "OrderAccessRateResult",
    audience: "internal",
    schema: orderAccess.orderAccessRateResultSchema,
  },
  {
    name: "OrderAccessConfiguration",
    audience: "internal",
    schema: orderAccess.orderAccessConfigurationSchema,
  },
  {
    name: "OrderAccessExchangeRequest",
    audience: "public-http",
    schema: orderAccess.orderAccessExchangeRequestSchema,
  },
  {
    name: "OrderAccessBootstrapRequest",
    audience: "public-http",
    schema: orderAccess.orderAccessBootstrapRequestSchema,
  },
  {
    name: "OrderAccessRevokeRequest",
    audience: "public-http",
    schema: orderAccess.orderAccessRevokeRequestSchema,
  },

  {
    name: "PaymentStablecoinConfig",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinConfigSchema,
  },
  {
    name: "OrderPaymentApplyCommand",
    audience: "internal",
    schema: orderPaymentApplication.orderPaymentApplyCommandSchema,
  },
  {
    name: "OrderPaymentApplyResult",
    audience: "internal",
    schema: orderPaymentApplication.orderPaymentApplyResultSchema,
  },
  {
    name: "OrderPaymentListPendingCommand",
    audience: "internal",
    schema: orderPaymentApplication.orderPaymentListPendingCommandSchema,
  },
  {
    name: "OrderPaymentPendingEvents",
    audience: "internal",
    schema: orderPaymentApplication.orderPaymentPendingEventsSchema,
  },
  {
    name: "OrderPaymentRunResult",
    audience: "internal",
    schema: orderPaymentApplication.orderPaymentRunResultSchema,
  },
  {
    name: "PaymentStablecoinQuote",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinQuoteSchema,
  },
  {
    name: "PaymentStablecoinObservation",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinObservationSchema,
  },
  {
    name: "PaymentStablecoinEvaluationCommand",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinEvaluationCommandSchema,
  },
  {
    name: "PaymentStablecoinEvaluation",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinEvaluationSchema,
  },
  {
    name: "PaymentStablecoinDecimalToAtomicCommand",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinDecimalToAtomicCommandSchema,
  },
  {
    name: "PaymentStablecoinAtomicToDecimalCommand",
    audience: "internal",
    schema: paymentStablecoin.paymentStablecoinAtomicToDecimalCommandSchema,
  },
  {
    name: "DeployedPaymentAdapter",
    audience: "internal",
    schema: paymentConnector.deployedPaymentAdapterSchema,
  },
  {
    name: "PaymentAccountConnection",
    audience: "internal",
    schema: paymentConnector.paymentAccountConnectionSchema,
  },
  {
    name: "PaymentConnectorSnapshot",
    audience: "internal",
    schema: paymentConnector.paymentConnectorSnapshotSchema,
  },
  {
    name: "PaymentGatewayWebhookConfig",
    audience: "internal",
    schema: paymentConnector.paymentGatewayWebhookConfigSchema,
  },
  {
    name: "PaymentRuntimeRecoveryRunResponse",
    audience: "internal",
    schema: paymentRuntimeConfig.paymentRuntimeRecoveryRunResponseSchema,
  },
  {
    name: "PaymentRuntimeEncryptedAction",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeEncryptedActionSchema,
  },
  {
    name: "PaymentRuntimeAttemptRecord",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeAttemptRecordSchema,
  },
  {
    name: "PaymentRuntimeRoute",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeRouteSchema,
  },
  {
    name: "PaymentRuntimeRouting",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeRoutingSchema,
  },
  {
    name: "PaymentRuntimeContext",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeContextSchema,
  },
  {
    name: "PaymentRuntimeCurrentCheckout",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeCurrentCheckoutSchema,
  },
  {
    name: "PaymentRuntimeLoadContextCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeLoadContextCommandSchema,
  },
  {
    name: "PaymentRuntimeLoadCurrentCheckoutCommand",
    audience: "internal",
    schema:
      paymentRuntimeInternal.paymentRuntimeLoadCurrentCheckoutCommandSchema,
  },
  {
    name: "PaymentRuntimeReadAttemptCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeReadAttemptCommandSchema,
  },
  {
    name: "PaymentRuntimeFindCreateReceiptCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeFindCreateReceiptCommandSchema,
  },
  {
    name: "PaymentRuntimeCreateReceipt",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeCreateReceiptSchema,
  },
  {
    name: "PaymentRuntimeBeginCreateCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeBeginCreateCommandSchema,
  },
  {
    name: "PaymentRuntimeClaim",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeClaimSchema,
  },
  {
    name: "PaymentRuntimeBeginCreateResult",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeBeginCreateResultSchema,
  },
  {
    name: "PaymentRuntimeSettleCreateCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeSettleCreateCommandSchema,
  },
  {
    name: "PaymentRuntimeClaimRecoveryCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeClaimRecoveryCommandSchema,
  },
  {
    name: "PaymentRuntimeRecordReconcileCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeRecordReconcileCommandSchema,
  },
  {
    name: "PaymentRuntimeDeferRecoveryCommand",
    audience: "internal",
    schema: paymentRuntimeInternal.paymentRuntimeDeferRecoveryCommandSchema,
  },
  {
    name: "PaymentRuntimeCapabilitiesCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeCapabilitiesCommandSchema,
  },
  {
    name: "PaymentRuntimeCreateCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeCreateCommandSchema,
  },
  {
    name: "PaymentRuntimeReadCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeReadCommandSchema,
  },
  {
    name: "PaymentRuntimeRecoverCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeRecoverCommandSchema,
  },
  {
    name: "PaymentRuntimeCurrentCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeCurrentCommandSchema,
  },
  {
    name: "PaymentRuntimeCommand",
    audience: "internal",
    schema: paymentRuntime.paymentRuntimeCommandSchema,
  },
  {
    name: "PaymentRuntimeCapabilitiesRequest",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeCapabilitiesRequestSchema,
  },
  {
    name: "PaymentRuntimeCreateRequest",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeCreateRequestSchema,
  },
  {
    name: "PaymentRuntimeReadRequest",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeReadRequestSchema,
  },
  {
    name: "PaymentRuntimeRecoverRequest",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeRecoverRequestSchema,
  },
  {
    name: "PaymentRuntimeCurrentRequest",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeCurrentRequestSchema,
  },
  {
    name: "PaymentRuntimeFailure",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeFailureSchema,
  },
  {
    name: "PaymentRuntimeAttemptView",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeAttemptViewSchema,
  },
  {
    name: "PaymentRuntimeCapabilityView",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeCapabilityViewSchema,
  },
  {
    name: "PaymentRuntimeCapabilitiesView",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeCapabilitiesViewSchema,
  },
  {
    name: "PaymentRuntimeResponse",
    audience: "public-http",
    schema: paymentRuntime.paymentRuntimeResponseSchema,
  },
  {
    name: "PaymentRuntimeProviderBinding",
    audience: "internal",
    schema: paymentRuntimeConfig.paymentRuntimeProviderBindingSchema,
  },
  {
    name: "PaymentRuntimeConfiguration",
    audience: "internal",
    schema: paymentRuntimeConfig.paymentRuntimeConfigurationSchema,
  },
  {
    name: "CheckoutTranslationSnapshot",
    audience: "internal",
    schema: checkoutTranslationSnapshotSchema,
  },
  {
    name: "CheckoutMediaSnapshot",
    audience: "internal",
    schema: checkoutMediaSnapshotSchema,
  },
  {
    name: "CheckoutPolicyAcceptance",
    audience: "internal",
    schema: checkoutPolicyAcceptanceSchema,
  },
  {
    name: "CheckoutPreflightValidateCommand",
    audience: "internal",
    schema: checkoutPreflightValidateCommandSchema,
  },
  {
    name: "CheckoutPreflightCreateCommand",
    audience: "internal",
    schema: checkoutPreflightCreateCommandSchema,
  },
  {
    name: "CheckoutPreflightReadCommand",
    audience: "internal",
    schema: checkoutPreflightReadCommandSchema,
  },
  {
    name: "CheckoutPreflightCommand",
    audience: "internal",
    schema: checkoutPreflightCommandSchema,
  },
  {
    name: "CheckoutPreflightFailure",
    audience: "public-http",
    schema: checkoutPreflightFailureSchema,
  },
  {
    name: "CheckoutPreflightValidateRequest",
    audience: "public-http",
    schema: checkoutPreflightValidateRequestSchema,
  },
  {
    name: "CheckoutPreflightCreateRequest",
    audience: "public-http",
    schema: checkoutPreflightCreateRequestSchema,
  },
  {
    name: "CheckoutPreflightReadRequest",
    audience: "public-http",
    schema: checkoutPreflightReadRequestSchema,
  },
  {
    name: "CheckoutPreflightLoadCurrentCommand",
    audience: "internal",
    schema: checkoutPreflightLoadCurrentCommandSchema,
  },
  {
    name: "CheckoutPreflightLineFacts",
    audience: "internal",
    schema: checkoutPreflightLineFactsSchema,
  },
  {
    name: "CheckoutPreflightPolicyFacts",
    audience: "internal",
    schema: checkoutPreflightPolicyFactsSchema,
  },
  {
    name: "CheckoutPreflightInventoryFacts",
    audience: "internal",
    schema: checkoutPreflightInventoryFactsSchema,
  },
  {
    name: "CheckoutPreflightConsent",
    audience: "internal",
    schema: checkoutPreflightConsentSchema,
  },
  {
    name: "CheckoutPreflightCurrent",
    audience: "internal",
    schema: checkoutPreflightCurrentSchema,
  },
  {
    name: "CheckoutPreflightObservation",
    audience: "internal",
    schema: checkoutPreflightObservationSchema,
  },
  {
    name: "CheckoutPreflightSaveCommand",
    audience: "internal",
    schema: checkoutPreflightSaveCommandSchema,
  },
  {
    name: "CheckoutPreflightFindCommand",
    audience: "internal",
    schema: checkoutPreflightFindCommandSchema,
  },
  {
    name: "CheckoutPreflightReadSessionCommand",
    audience: "internal",
    schema: checkoutPreflightReadSessionCommandSchema,
  },
  {
    name: "CheckoutEncryptedContact",
    audience: "internal",
    schema: checkoutEncryptedContactSchema,
  },
  {
    name: "CheckoutPreflightCommitCommand",
    audience: "internal",
    schema: checkoutPreflightCommitCommandSchema,
  },
  {
    name: "CheckoutPreflightReceipt",
    audience: "internal",
    schema: checkoutPreflightReceiptSchema,
  },
  {
    name: "CheckoutPreflightSessionRecord",
    audience: "internal",
    schema: checkoutPreflightSessionRecordSchema,
  },
  {
    name: "CheckoutPreflightPublicLine",
    audience: "public-http",
    schema: checkoutPreflightPublicLineSchema,
  },
  {
    name: "CheckoutPreflightPublicPolicy",
    audience: "public-http",
    schema: checkoutPreflightPublicPolicySchema,
  },
  {
    name: "CheckoutPreflightView",
    audience: "public-http",
    schema: checkoutPreflightViewSchema,
  },
  {
    name: "CheckoutSessionView",
    audience: "public-http",
    schema: checkoutSessionViewSchema,
  },
  {
    name: "CheckoutPreflightResponse",
    audience: "public-http",
    schema: checkoutPreflightResponseSchema,
  },
  {
    name: "CheckoutInventoryAssignment",
    audience: "internal",
    schema: checkoutInventoryAssignmentSchema,
  },
  {
    name: "CheckoutInventorySelection",
    audience: "internal",
    schema: checkoutInventorySelectionSchema,
  },
  {
    name: "CheckoutInventoryPlanCommand",
    audience: "internal",
    schema: checkoutInventoryPlanCommandSchema,
  },
  {
    name: "CheckoutInventoryPlan",
    audience: "internal",
    schema: checkoutInventoryPlanSchema,
  },
  {
    name: "CartEditUpdateCommand",
    audience: "internal",
    schema: cartEditUpdateCommandSchema,
  },
  {
    name: "CartEditRemoveCommand",
    audience: "internal",
    schema: cartEditRemoveCommandSchema,
  },
  {
    name: "CartEditorReadCommand",
    audience: "internal",
    schema: cartEditorReadCommandSchema,
  },
  {
    name: "CartEditCommand",
    audience: "internal",
    schema: cartEditCommandSchema,
  },
  {
    name: "CartEditFailure",
    audience: "public-http",
    schema: cartEditFailureSchema,
  },
  {
    name: "CartEditResponse",
    audience: "public-http",
    schema: cartEditResponseSchema,
  },
  {
    name: "CartEditorResponse",
    audience: "public-http",
    schema: cartEditorResponseSchema,
  },
  {
    name: "CartRuntimeCurrentResponse",
    audience: "public-http",
    schema: cartRuntimeCurrentResponseSchema,
  },
  {
    name: "CartEditLoadItemCommand",
    audience: "internal",
    schema: cartEditLoadItemCommandSchema,
  },
  {
    name: "CartEditItemSnapshot",
    audience: "internal",
    schema: cartEditItemSnapshotSchema,
  },
  {
    name: "CartEditLoadPrivateCommand",
    audience: "internal",
    schema: cartEditLoadPrivateCommandSchema,
  },
  {
    name: "CartEditPrivateSnapshot",
    audience: "internal",
    schema: cartEditPrivateSnapshotSchema,
  },
  {
    name: "CartEditConfirmPrivateCommand",
    audience: "internal",
    schema: cartEditConfirmPrivateCommandSchema,
  },
  {
    name: "CartEditWriteMutationCommand",
    audience: "internal",
    schema: cartEditWriteMutationCommandSchema,
  },
  {
    name: "CartEditFindMutationReceiptCommand",
    audience: "internal",
    schema: cartEditFindMutationReceiptCommandSchema,
  },
  {
    name: "CartEditMutationReceipt",
    audience: "internal",
    schema: cartEditMutationReceiptSchema,
  },
  {
    name: "CartEditUpdateRequest",
    audience: "public-http",
    schema: cartEditUpdateRequestSchema,
  },
  {
    name: "CartEditRemoveRequest",
    audience: "public-http",
    schema: cartEditRemoveRequestSchema,
  },
  {
    name: "CartEditorReadRequest",
    audience: "public-http",
    schema: cartEditorReadRequestSchema,
  },
  { name: "CartEditEvent", audience: "internal", schema: cartEditEventSchema },

  {
    name: "CartRuntimeInitializeCommand",
    audience: "internal",
    schema: cartRuntimeInitializeCommandSchema,
  },
  {
    name: "CartRuntimeReadCommand",
    audience: "internal",
    schema: cartRuntimeReadCommandSchema,
  },
  {
    name: "CartRuntimeAddCommand",
    audience: "internal",
    schema: cartRuntimeAddCommandSchema,
  },
  {
    name: "CartRuntimeCommand",
    audience: "internal",
    schema: cartRuntimeCommandSchema,
  },
  {
    name: "CartRuntimeFailure",
    audience: "public-http",
    schema: cartRuntimeFailureSchema,
  },
  {
    name: "CartRuntimeAccess",
    audience: "internal",
    schema: cartRuntimeAccessSchema,
  },
  {
    name: "CartRuntimeHeader",
    audience: "internal",
    schema: cartRuntimeHeaderSchema,
  },
  {
    name: "CartRuntimeItemRecord",
    audience: "internal",
    schema: cartRuntimeItemRecordSchema,
  },
  {
    name: "CartRuntimeInitializeRecordCommand",
    audience: "internal",
    schema: cartRuntimeInitializeRecordCommandSchema,
  },
  {
    name: "CartRuntimeCredentialCommand",
    audience: "internal",
    schema: cartRuntimeCredentialCommandSchema,
  },
  {
    name: "CartRuntimeListItemsCommand",
    audience: "internal",
    schema: cartRuntimeListItemsCommandSchema,
  },
  {
    name: "CartRuntimeResolveGiftCommand",
    audience: "internal",
    schema: cartRuntimeResolveGiftCommandSchema,
  },
  {
    name: "CartRuntimeResolvedGift",
    audience: "internal",
    schema: cartRuntimeResolvedGiftSchema,
  },
  {
    name: "CartRuntimeAppendItemCommand",
    audience: "internal",
    schema: cartRuntimeAppendItemCommandSchema,
  },
  {
    name: "CartRuntimeFindReceiptCommand",
    audience: "internal",
    schema: cartRuntimeFindReceiptCommandSchema,
  },
  {
    name: "CartRuntimeReceipt",
    audience: "internal",
    schema: cartRuntimeReceiptSchema,
  },
  {
    name: "CartRuntimeItemView",
    audience: "public-http",
    schema: cartRuntimeItemViewSchema,
  },
  {
    name: "CartRuntimeView",
    audience: "public-http",
    schema: cartRuntimeViewSchema,
  },
  {
    name: "CartRuntimeResponse",
    audience: "public-http",
    schema: cartRuntimeResponseSchema,
  },
  {
    name: "CartRuntimeAddDecisionInput",
    audience: "internal",
    schema: cartRuntimeAddDecisionInputSchema,
  },
  {
    name: "CartRuntimeAddDecision",
    audience: "internal",
    schema: cartRuntimeAddDecisionSchema,
  },
  {
    name: "CartRuntimeProjectionInput",
    audience: "internal",
    schema: cartRuntimeProjectionInputSchema,
  },
  {
    name: "CartRuntimeRequestContext",
    audience: "internal",
    schema: cartRuntimeRequestContextSchema,
  },
  {
    name: "CartRuntimeInitializeRequest",
    audience: "public-http",
    schema: cartRuntimeInitializeRequestSchema,
  },
  {
    name: "CartRuntimeAddRequest",
    audience: "public-http",
    schema: cartRuntimeAddRequestSchema,
  },

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
    schema: legacyPublishedIdolViewSchema,
  },
  {
    name: "PublishedGiftView",
    audience: "public-http",
    schema: legacyPublishedGiftViewSchema,
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
    schema: legacyPublishedHomepageViewSchema,
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
    schema: legacyPublishedMediaViewSchema,
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
    name: "GenerateSupportIntentKeyCommand",
    audience: "internal",
    schema: generateSupportIntentKeyCommandSchema,
  },
  {
    name: "GenerateSupportIntentKeyResponse",
    audience: "internal",
    schema: generateSupportIntentKeyResponseSchema,
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
    schema: legacyIdolDirectoryRecordSchema,
  },
  {
    name: "GiftDirectoryRecord",
    audience: "internal",
    schema: legacyGiftDirectoryRecordSchema,
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
    schema: legacyIdolDirectorySnapshotSchema,
  },
  {
    name: "GiftDirectorySnapshot",
    audience: "internal",
    schema: legacyGiftDirectorySnapshotSchema,
  },
  {
    name: "IdolDirectoryResponse",
    audience: "public-http",
    schema: legacyIdolDirectoryResponseSchema,
  },
  {
    name: "GiftDirectoryResponse",
    audience: "public-http",
    schema: legacyGiftDirectoryResponseSchema,
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
    schema: legacyPublishedContentResponseSchema,
  },
  {
    name: "PublishedContentContext",
    audience: "internal",
    schema: legacyPublishedContentContextSchema,
  },
  {
    name: "PublishedContentContextResponse",
    audience: "internal",
    schema: legacyPublishedContentContextResponseSchema,
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
    name: "AdminAccessSettings",
    audience: "internal",
    schema: adminAccess.adminAccessSettingsSchema,
  },
  {
    name: "AdminAccessFailure",
    audience: "internal",
    schema: adminAccess.adminAccessFailureSchema,
  },
  {
    name: "AdminAccessBeginRequest",
    audience: "internal",
    schema: adminAccess.adminAccessBeginRequestSchema,
  },
  {
    name: "AdminAccessCallbackRequest",
    audience: "internal",
    schema: adminAccess.adminAccessCallbackRequestSchema,
  },
  {
    name: "AdminAccessLogoutRequest",
    audience: "internal",
    schema: adminAccess.adminAccessLogoutRequestSchema,
  },
  {
    name: "AdminAccessBeginBrowserResponse",
    audience: "internal",
    schema: adminAccess.adminAccessBeginBrowserResponseSchema,
  },
  {
    name: "AdminAccessBeginResponse",
    audience: "internal",
    schema: adminAccess.adminAccessBeginResponseSchema,
  },
  {
    name: "AdminAccessCallbackResponse",
    audience: "internal",
    schema: adminAccess.adminAccessCallbackResponseSchema,
  },
  {
    name: "AdminAccessLogoutResponse",
    audience: "internal",
    schema: adminAccess.adminAccessLogoutResponseSchema,
  },
  {
    name: "AdminAccessCreateCommand",
    audience: "internal",
    schema: adminAccess.adminAccessCreateCommandSchema,
  },
  {
    name: "AdminAccessCreateResponse",
    audience: "internal",
    schema: adminAccess.adminAccessCreateResponseSchema,
  },
  {
    name: "AdminAccessClaimCommand",
    audience: "internal",
    schema: adminAccess.adminAccessClaimCommandSchema,
  },
  {
    name: "AdminAccessClaimResponse",
    audience: "internal",
    schema: adminAccess.adminAccessClaimResponseSchema,
  },
  {
    name: "AdminAccessCompleteCommand",
    audience: "internal",
    schema: adminAccess.adminAccessCompleteCommandSchema,
  },
  {
    name: "AdminAccessCompleteResponse",
    audience: "internal",
    schema: adminAccess.adminAccessCompleteResponseSchema,
  },
  {
    name: "AdminAccessRevokeCommand",
    audience: "internal",
    schema: adminAccess.adminAccessRevokeCommandSchema,
  },
  {
    name: "AdminAccessRejectCommand",
    audience: "internal",
    schema: adminAccess.adminAccessRejectCommandSchema,
  },
  {
    name: "AdminAccessRejectResponse",
    audience: "internal",
    schema: adminAccess.adminAccessRejectResponseSchema,
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
  {
    name: "GiftCommerceFailure",
    audience: "admin-http",
    schema: giftCommerceFailureSchema,
  },
  {
    name: "GiftCommerceAuthorizationCommand",
    audience: "internal",
    schema: giftCommerceAuthorizationCommandSchema,
  },
  {
    name: "GiftCommerceAuthorizationResponse",
    audience: "internal",
    schema: giftCommerceAuthorizationResponseSchema,
  },
  {
    name: "GiftCommerceAccessContextCommand",
    audience: "internal",
    schema: giftCommerceAccessContextCommandSchema,
  },
  {
    name: "GiftCommerceAccessContextResponse",
    audience: "internal",
    schema: giftCommerceAccessContextResponseSchema,
  },
  {
    name: "GiftCommerceContentAuthoring",
    audience: "admin-http",
    schema: giftCommerceContentAuthoringSchema,
  },
  {
    name: "GiftCommerceReadCommand",
    audience: "admin-http",
    schema: giftCommerceReadCommandSchema,
  },
  {
    name: "GiftCommerceMutationCommand",
    audience: "admin-http",
    schema: giftCommerceMutationCommandSchema,
  },
  {
    name: "GiftCommerceCommand",
    audience: "admin-http",
    schema: giftCommerceCommandSchema,
  },
  {
    name: "GiftCommerceRequest",
    audience: "admin-http",
    schema: giftCommerceRequestSchema,
  },
  {
    name: "GiftCommerceWriteCommand",
    audience: "internal",
    schema: giftCommerceWriteCommandSchema,
  },
  {
    name: "GiftCommerceReceiptReadCommand",
    audience: "internal",
    schema: giftCommerceReceiptReadCommandSchema,
  },
  {
    name: "GiftCommerceVariant",
    audience: "admin-http",
    schema: giftCommerceVariantSchema,
  },
  {
    name: "GiftCommerceGift",
    audience: "admin-http",
    schema: giftCommerceGiftSchema,
  },
  {
    name: "GiftCommercePriceBook",
    audience: "admin-http",
    schema: giftCommercePriceBookSchema,
  },
  {
    name: "GiftCommercePrice",
    audience: "admin-http",
    schema: giftCommercePriceSchema,
  },
  {
    name: "GiftCommerceRawContext",
    audience: "internal",
    schema: giftCommerceRawContextSchema,
  },
  {
    name: "GiftCommerceContextResponse",
    audience: "admin-http",
    schema: giftCommerceContextResponseSchema,
  },
  {
    name: "GiftCommerceReadResponse",
    audience: "admin-http",
    schema: giftCommerceReadResponseSchema,
  },
  {
    name: "GiftCommerceMutation",
    audience: "admin-http",
    schema: giftCommerceMutationSchema,
  },
  {
    name: "GiftCommerceResponse",
    audience: "admin-http",
    schema: giftCommerceResponseSchema,
  },
  {
    name: "GiftRevisionProfile",
    audience: "internal",
    schema: giftRevisionProfileSchema,
  },
  {
    name: "GiftPublicationProfile",
    audience: "internal",
    schema: giftPublicationProfileSchema,
  },
  {
    name: "PublishedGiftCommerceReadCommand",
    audience: "public-http",
    schema: publishedGiftCommerceReadCommandSchema,
  },
  {
    name: "PublishedGiftCommerceResponse",
    audience: "public-http",
    schema: legacyPublishedGiftCommerceResponseSchema,
  },
  {
    name: "PublishedGiftCommerceContextResponse",
    audience: "internal",
    schema: legacyPublishedGiftCommerceContextResponseSchema,
  },
  {
    name: "StorefrontHomepageReadCommand",
    audience: "public-http",
    schema: storefrontHomepageReadCommandSchema,
  },
  {
    name: "StorefrontHomepageContextResponse",
    audience: "internal",
    schema: legacyStorefrontHomepageContextResponseSchema,
  },
  {
    name: "StorefrontHomepageResponse",
    audience: "public-http",
    schema: legacyStorefrontHomepageResponseSchema,
  },
  {
    name: "StorefrontContextReadCommand",
    audience: "public-http",
    schema: storefrontContextReadCommandSchema,
  },
  {
    name: "StorefrontContextResponse",
    audience: "public-http",
    schema: storefrontContextResponseSchema,
  },
  {
    name: "StorefrontGiftReadCommand",
    audience: "public-http",
    schema: storefrontGiftReadCommandSchema,
  },
  {
    name: "StorefrontGiftResponse",
    audience: "public-http",
    schema: legacyStorefrontGiftResponseSchema,
  },
  {
    name: "StorefrontGiftContextResponse",
    audience: "internal",
    schema: legacyStorefrontGiftContextResponseSchema,
  },
  {
    name: "StorefrontSeoReadCommand",
    audience: "public-http",
    schema: storefrontSeoReadCommandSchema,
  },
  {
    name: "StorefrontSeoEntity",
    audience: "public-http",
    schema: storefrontSeoEntitySchema,
  },
  {
    name: "StorefrontSeoResponse",
    audience: "public-http",
    schema: storefrontSeoResponseSchema,
  },
  {
    name: "StorefrontSeoSnapshot",
    audience: "internal",
    schema: storefrontSeoSnapshotSchema,
  },
  {
    name: "CurrentPublishedIdolView",
    audience: "public-http",
    schema: publishedIdolViewSchema,
  },
  {
    name: "CurrentPublishedGiftView",
    audience: "public-http",
    schema: publishedGiftViewSchema,
  },
  {
    name: "CurrentPublishedMediaView",
    audience: "public-http",
    schema: publishedMediaViewSchema,
  },
  {
    name: "CurrentPublishedHomepageView",
    audience: "public-http",
    schema: publishedHomepageViewSchema,
  },
  {
    name: "CurrentPublishedContentResponse",
    audience: "public-http",
    schema: publishedContentResponseSchema,
  },
  {
    name: "CurrentIdolDirectoryResponse",
    audience: "public-http",
    schema: idolDirectoryResponseSchema,
  },
  {
    name: "CurrentGiftDirectoryResponse",
    audience: "public-http",
    schema: giftDirectoryResponseSchema,
  },
  {
    name: "CurrentPublishedGiftCommerceResponse",
    audience: "public-http",
    schema: publishedGiftCommerceResponseSchema,
  },
  {
    name: "CurrentStorefrontHomepageResponse",
    audience: "public-http",
    schema: storefrontHomepageResponseSchema,
  },
  {
    name: "CurrentStorefrontGiftResponse",
    audience: "public-http",
    schema: storefrontGiftResponseSchema,
  },
  {
    name: "CurrentPublishedContentContext",
    audience: "internal",
    schema: publishedContentContextSchema,
  },
  {
    name: "CurrentPublishedContentContextResponse",
    audience: "internal",
    schema: publishedContentContextResponseSchema,
  },
  {
    name: "CurrentPublishedGiftCommerceContextResponse",
    audience: "internal",
    schema: publishedGiftCommerceContextResponseSchema,
  },
  {
    name: "CurrentStorefrontHomepageContextResponse",
    audience: "internal",
    schema: storefrontHomepageContextResponseSchema,
  },
  {
    name: "CurrentStorefrontGiftContextResponse",
    audience: "internal",
    schema: storefrontGiftContextResponseSchema,
  },
  {
    name: "CurrentIdolDirectoryRecord",
    audience: "internal",
    schema: idolDirectoryRecordSchema,
  },
  {
    name: "CurrentGiftDirectoryRecord",
    audience: "internal",
    schema: giftDirectoryRecordSchema,
  },
  {
    name: "CurrentIdolDirectorySnapshot",
    audience: "internal",
    schema: idolDirectorySnapshotSchema,
  },
  {
    name: "CurrentGiftDirectorySnapshot",
    audience: "internal",
    schema: giftDirectorySnapshotSchema,
  },
  {
    name: "ManagementCenterPrice",
    audience: "admin-http",
    schema: managementCenterPriceSchema,
  },
  {
    name: "ManagementCenterInventory",
    audience: "admin-http",
    schema: managementCenterInventorySchema,
  },
  {
    name: "ManagementCenterIntent",
    audience: "admin-http",
    schema: managementCenterIntentSchema,
  },
  {
    name: "ManagementCenterFailure",
    audience: "admin-http",
    schema: managementCenterFailureSchema,
  },
  {
    name: "ManagementCenterOperation",
    audience: "admin-http",
    schema: managementCenterOperationSchema,
  },
  {
    name: "ManagementCenterCommand",
    audience: "admin-http",
    schema: managementCenterCommandSchema,
  },
  {
    name: "ManagementCenterRequest",
    audience: "admin-http",
    schema: managementCenterRequestSchema,
  },
  {
    name: "ManagementCenterListItem",
    audience: "admin-http",
    schema: managementCenterListItemSchema,
  },
  {
    name: "ManagementCenterResponse",
    audience: "admin-http",
    schema: managementCenterResponseSchema,
  },
  {
    name: "ManagementCenterAuthorization",
    audience: "internal",
    schema: managementCenterAuthorizationSchema,
  },
  {
    name: "ManagementCenterPreparedMedia",
    audience: "internal",
    schema: managementCenterPreparedMediaSchema,
  },
  {
    name: "ManagementCenterCheckpoint",
    audience: "internal",
    schema: managementCenterCheckpointSchema,
  },
  {
    name: "ManagementCenterClaim",
    audience: "internal",
    schema: managementCenterClaimSchema,
  },
  {
    name: "SingleSourceLocaleContext",
    audience: "internal",
    schema: singleSourceLocaleContextSchema,
  },
  {
    name: "ContentLocaleContext",
    audience: "internal",
    schema: contentLocaleContextSchema,
  },
  {
    name: "DailyMediaMetadataDocument",
    audience: "internal",
    schema: dailyMediaMetadataDocumentSchema,
  },
  {
    name: "DailyPublicationDocument",
    audience: "internal",
    schema: dailyPublicationDocumentSchema,
  },
  {
    name: "DailyPublicationManifest",
    audience: "internal",
    schema: dailyPublicationManifestSchema,
  },
  {
    name: "DailyPublicationCurrentMedia",
    audience: "internal",
    schema: dailyPublicationCurrentMediaSchema,
  },
  {
    name: "DailyPublicationContext",
    audience: "internal",
    schema: dailyPublicationContextSchema,
  },
  {
    name: "PaymentHealthPolicy",
    audience: "internal",
    schema: paymentHealth.paymentHealthPolicySchema,
  },
  {
    name: "PaymentHealthCapabilitiesCommand",
    audience: "internal",
    schema: paymentHealth.paymentHealthCapabilitiesCommandSchema,
  },
  {
    name: "PaymentHealthProbeContext",
    audience: "internal",
    schema: paymentHealth.paymentHealthProbeContextSchema,
  },
  {
    name: "PaymentHealthObservation",
    audience: "internal",
    schema: paymentHealth.paymentHealthObservationSchema,
  },
  {
    name: "PaymentHealthSnapshot",
    audience: "internal",
    schema: paymentHealth.paymentHealthSnapshotSchema,
  },
  {
    name: "PaymentHealthRecordResult",
    audience: "internal",
    schema: paymentHealth.paymentHealthRecordResultSchema,
  },
  {
    name: "PaymentHealthClaimProbeCommand",
    audience: "internal",
    schema: paymentHealth.paymentHealthClaimProbeCommandSchema,
  },
  {
    name: "PaymentHealthProbeLease",
    audience: "internal",
    schema: paymentHealth.paymentHealthProbeLeaseSchema,
  },
  {
    name: "PaymentHealthCompleteProbeCommand",
    audience: "internal",
    schema: paymentHealth.paymentHealthCompleteProbeCommandSchema,
  },
  {
    name: "PaymentHealthProbeResult",
    audience: "internal",
    schema: paymentHealth.paymentHealthProbeResultSchema,
  },
  {
    name: "PaymentHealthWindowInput",
    audience: "internal",
    schema: paymentHealth.paymentHealthWindowInputSchema,
  },
  {
    name: "PaymentHealthWindowResult",
    audience: "internal",
    schema: paymentHealth.paymentHealthWindowResultSchema,
  },
  {
    name: "PaymentRolloutInput",
    audience: "internal",
    schema: paymentRollout.paymentRolloutInputSchema,
  },
  {
    name: "PaymentRolloutDecision",
    audience: "internal",
    schema: paymentRollout.paymentRolloutDecisionSchema,
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
import {
  storefrontSeoReadCommandSchema,
  storefrontSeoEntitySchema,
  storefrontSeoResponseSchema,
  storefrontSeoSnapshotSchema,
} from "./storefront-seo.js";
