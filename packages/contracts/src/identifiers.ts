import { z } from "zod";

export const idolIdSchema = z.uuid().brand<"IdolId">();
export const idolRevisionIdSchema = z.uuid().brand<"IdolRevisionId">();
export const giftIdSchema = z.uuid().brand<"GiftId">();
export const giftRevisionIdSchema = z.uuid().brand<"GiftRevisionId">();
export const giftVariantIdSchema = z.uuid().brand<"GiftVariantId">();
export const cartItemIdSchema = z.uuid().brand<"CartItemId">();
export const cartIdSchema = z.uuid().brand<"CartId">();
export const supportIntentIdSchema = z.uuid().brand<"SupportIntentId">();
export const priceIdSchema = z.uuid().brand<"PriceId">();
export const priceBookIdSchema = z.uuid().brand<"PriceBookId">();
export const checkoutQuoteIdSchema = z.uuid().brand<"CheckoutQuoteId">();
export const checkoutSessionIdSchema = z.uuid().brand<"CheckoutSessionId">();
export const inventoryReservationIdSchema = z
  .uuid()
  .brand<"InventoryReservationId">();
export const inventoryLocationIdSchema = z
  .uuid()
  .brand<"InventoryLocationId">();
export const inventoryItemIdSchema = z.uuid().brand<"InventoryItemId">();
export const inventoryLedgerEntryIdSchema = z
  .uuid()
  .brand<"InventoryLedgerEntryId">();
export const orderIdSchema = z.uuid().brand<"OrderId">();
export const publicOrderIdSchema = z.uuid().brand<"PublicOrderId">();
export const orderItemIdSchema = z.uuid().brand<"OrderItemId">();
export const paymentAttemptIdSchema = z.uuid().brand<"PaymentAttemptId">();
export const paymentCapabilityIdSchema = z
  .uuid()
  .brand<"PaymentCapabilityId">();
export const providerAccountIdSchema = z.uuid().brand<"ProviderAccountId">();
export const refundIdSchema = z.uuid().brand<"RefundId">();
export const disputeIdSchema = z.uuid().brand<"DisputeId">();
export const mediaAssetIdSchema = z.uuid().brand<"MediaAssetId">();
export const mediaVariantIdSchema = z.uuid().brand<"MediaVariantId">();
export const mediaMetadataRevisionIdSchema = z
  .uuid()
  .brand<"MediaMetadataRevisionId">();
export const translationRevisionIdSchema = z
  .uuid()
  .brand<"TranslationRevisionId">();
export const translationApprovalIdSchema = z
  .uuid()
  .brand<"TranslationApprovalId">();
export const policyRevisionIdSchema = z.uuid().brand<"PolicyRevisionId">();
export const policyTranslationRevisionIdSchema = z
  .uuid()
  .brand<"PolicyTranslationRevisionId">();
export const homepageRevisionIdSchema = z.uuid().brand<"HomepageRevisionId">();
export const homepageTranslationRevisionIdSchema = z
  .uuid()
  .brand<"HomepageTranslationRevisionId">();
export const contentPublicationIdSchema = z
  .uuid()
  .brand<"ContentPublicationId">();
export const fulfillmentIdSchema = z.uuid().brand<"FulfillmentId">();
export const notificationDeliveryIdSchema = z
  .uuid()
  .brand<"NotificationDeliveryId">();
export const customerContactIdSchema = z.uuid().brand<"CustomerContactId">();
export const contentRevisionIdSchema = z.uuid().brand<"ContentRevisionId">();
export const eventIdSchema = z.uuid().brand<"EventId">();
export const webhookInboxIdSchema = z.uuid().brand<"WebhookInboxId">();
export const auditLogIdSchema = z.uuid().brand<"AuditLogId">();
export const adminIdentityIdSchema = z.uuid().brand<"AdminIdentityId">();
export const moderationEvidenceIdSchema = z
  .uuid()
  .brand<"ModerationEvidenceId">();
export const cartAccessTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .brand<"CartAccessToken">();
export const orderAccessTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .brand<"OrderAccessToken">();
export const providerReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
  .brand<"ProviderReference">();
export const merchantReferenceSchema = z.uuid().brand<"MerchantReference">();
export const providerIdempotencyKeySchema = z
  .uuid()
  .brand<"ProviderIdempotencyKey">();
export const externalPaymentReferenceSchema =
  providerReferenceSchema.brand<"ExternalPaymentReference">();
export const providerEventReferenceSchema =
  providerReferenceSchema.brand<"ProviderEventReference">();
export const providerRefundReferenceSchema =
  providerReferenceSchema.brand<"ProviderRefundReference">();
export const providerDisputeReferenceSchema =
  providerReferenceSchema.brand<"ProviderDisputeReference">();
export const providerClientTokenSchema = z
  .string()
  .min(16)
  .max(4_096)
  .regex(/^[A-Za-z0-9._~:+/=-]+$/u)
  .brand<"ProviderClientToken">();
export const paymentReturnStateSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .brand<"PaymentReturnState">();
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
  .brand<"IdempotencyKey">();

export type IdolId = z.infer<typeof idolIdSchema>;
export type IdolRevisionId = z.infer<typeof idolRevisionIdSchema>;
export type GiftId = z.infer<typeof giftIdSchema>;
export type GiftRevisionId = z.infer<typeof giftRevisionIdSchema>;
export type GiftVariantId = z.infer<typeof giftVariantIdSchema>;
export type CartItemId = z.infer<typeof cartItemIdSchema>;
export type CartId = z.infer<typeof cartIdSchema>;
export type SupportIntentId = z.infer<typeof supportIntentIdSchema>;
export type PriceId = z.infer<typeof priceIdSchema>;
export type PriceBookId = z.infer<typeof priceBookIdSchema>;
export type CheckoutQuoteId = z.infer<typeof checkoutQuoteIdSchema>;
export type CheckoutSessionId = z.infer<typeof checkoutSessionIdSchema>;
export type InventoryReservationId = z.infer<
  typeof inventoryReservationIdSchema
>;
export type InventoryLocationId = z.infer<typeof inventoryLocationIdSchema>;
export type InventoryItemId = z.infer<typeof inventoryItemIdSchema>;
export type InventoryLedgerEntryId = z.infer<
  typeof inventoryLedgerEntryIdSchema
>;
export type OrderId = z.infer<typeof orderIdSchema>;
export type PublicOrderId = z.infer<typeof publicOrderIdSchema>;
export type OrderItemId = z.infer<typeof orderItemIdSchema>;
export type PaymentAttemptId = z.infer<typeof paymentAttemptIdSchema>;
export type PaymentCapabilityId = z.infer<typeof paymentCapabilityIdSchema>;
export type ProviderAccountId = z.infer<typeof providerAccountIdSchema>;
export type RefundId = z.infer<typeof refundIdSchema>;
export type DisputeId = z.infer<typeof disputeIdSchema>;
export type MediaAssetId = z.infer<typeof mediaAssetIdSchema>;
export type MediaVariantId = z.infer<typeof mediaVariantIdSchema>;
export type MediaMetadataRevisionId = z.infer<
  typeof mediaMetadataRevisionIdSchema
>;
export type TranslationRevisionId = z.infer<typeof translationRevisionIdSchema>;
export type TranslationApprovalId = z.infer<typeof translationApprovalIdSchema>;
export type PolicyRevisionId = z.infer<typeof policyRevisionIdSchema>;
export type PolicyTranslationRevisionId = z.infer<
  typeof policyTranslationRevisionIdSchema
>;
export type HomepageRevisionId = z.infer<typeof homepageRevisionIdSchema>;
export type HomepageTranslationRevisionId = z.infer<
  typeof homepageTranslationRevisionIdSchema
>;
export type ContentPublicationId = z.infer<typeof contentPublicationIdSchema>;
export type FulfillmentId = z.infer<typeof fulfillmentIdSchema>;
export type NotificationDeliveryId = z.infer<
  typeof notificationDeliveryIdSchema
>;
export type CustomerContactId = z.infer<typeof customerContactIdSchema>;
export type ContentRevisionId = z.infer<typeof contentRevisionIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type WebhookInboxId = z.infer<typeof webhookInboxIdSchema>;
export type AuditLogId = z.infer<typeof auditLogIdSchema>;
export type AdminIdentityId = z.infer<typeof adminIdentityIdSchema>;
export type ModerationEvidenceId = z.infer<typeof moderationEvidenceIdSchema>;
export type CartAccessToken = z.infer<typeof cartAccessTokenSchema>;
export type OrderAccessToken = z.infer<typeof orderAccessTokenSchema>;
export type ProviderReference = z.infer<typeof providerReferenceSchema>;
export type MerchantReference = z.infer<typeof merchantReferenceSchema>;
export type ProviderIdempotencyKey = z.infer<
  typeof providerIdempotencyKeySchema
>;
export type ExternalPaymentReference = z.infer<
  typeof externalPaymentReferenceSchema
>;
export type ProviderEventReference = z.infer<
  typeof providerEventReferenceSchema
>;
export type ProviderRefundReference = z.infer<
  typeof providerRefundReferenceSchema
>;
export type ProviderDisputeReference = z.infer<
  typeof providerDisputeReferenceSchema
>;
export type ProviderClientToken = z.infer<typeof providerClientTokenSchema>;
export type PaymentReturnState = z.infer<typeof paymentReturnStateSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
