import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { checkoutText, checkoutVersionSchema } from "./checkout-preflight.js";
import { currencySchema, minorAmountSchema } from "./commerce.js";
import { idempotencyKeySchema, publicOrderIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { orderAccessDetailSchema } from "./order-access.js";
import {
  disputeStatusSchema,
  fulfillmentStatusSchema,
  orderStatusSchema,
} from "./order.js";
import { orderPaymentStatusSchema } from "./payment.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { cartEditorContentSchema } from "./cart-edit.js";

const uuid = z.uuid();
const version = z.literal(1);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
export const adminOrdersPermissionSchema = z.enum([
  "orders.read",
  "orders.message.read",
  "orders.message.review",
  "orders.message.triage",
  "orders.fulfillment",
  "orders.note",
  "orders.notification.resend",
  "orders.manage",
]);
export const adminOrdersFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "STALE_VERSION",
    "IDEMPOTENCY_CONFLICT",
    "CONFLICT",
    "PAYMENT_NOT_CONFIRMED",
    "MODERATION_REQUIRED",
    "LANGUAGE_REVIEW_REQUIRED",
    "PRIVATE_CONTENT_UNAVAILABLE",
    "PRIVATE_ACCESS_EXPIRED",
    "TRANSITION_NOT_ALLOWED",
    "NOTIFICATION_NOT_READY",
    "NOTIFICATION_IN_PROGRESS",
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});
const mutation = {
  orderId: uuid,
  expectedOrderVersion: checkoutVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  reasonCode: reason,
};
const lineMutation = {
  ...mutation,
  fulfillmentId: uuid,
  expectedFulfillmentVersion: checkoutVersionSchema,
};
const pagination = {
  page: z.number().int().min(1).max(10000),
  pageSize: z.number().int().min(1).max(50),
};
const privateTarget = {
  orderId: uuid,
  itemId: uuid,
  expectedIntentVersion: checkoutVersionSchema,
  reviewLocale: supportedLocaleSchema,
};
export const adminOrdersCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: version, action: z.literal("CONTEXT") }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("LIST"),
    ...pagination,
    query: z.string().trim().max(80),
    fulfillment: z.union([z.literal("ALL"), fulfillmentStatusSchema]),
    moderation: z.enum(["ALL", "NEEDS_REVIEW", "REJECTED"]),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("DETAIL"),
    orderId: uuid,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_MESSAGE"),
    ...privateTarget,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("REVIEW_MESSAGE"),
    ...mutation,
    itemId: uuid,
    expectedIntentVersion: checkoutVersionSchema,
    accessId: uuid,
    reviewLocale: supportedLocaleSchema,
    languageConfirmed: z.literal(true),
    decision: z.enum(["APPROVED", "REJECTED"]),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("PREPARE"),
    ...lineMutation,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("DELIVER"),
    ...lineMutation,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("HOLD"),
    ...lineMutation,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("RESUME"),
    ...lineMutation,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("ADD_NOTE"),
    ...mutation,
    note: checkoutText(1000),
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ_NOTES"),
    orderId: uuid,
  }),
  z.strictObject({
    schemaVersion: version,
    action: z.literal("RESEND_NOTIFICATION"),
    ...mutation,
    expectedLatestNotificationId: uuid,
  }),
]);
export const adminOrdersRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminOrdersCommandSchema,
});
export const adminOrdersListItemSchema = z.strictObject({
  orderId: uuid,
  publicOrderId: publicOrderIdSchema,
  version: checkoutVersionSchema,
  presentationLocale: supportedLocaleSchema,
  orderStatus: orderStatusSchema,
  paymentStatus: orderPaymentStatusSchema,
  disputeStatus: disputeStatusSchema,
  fulfillmentStatus: fulfillmentStatusSchema,
  currency: currencySchema,
  totalAmountMinor: minorAmountSchema,
  itemCount: z.number().int().min(1).max(500),
  pendingReviewCount: z.number().int().min(0).max(500),
  createdAt: contentTimestampSchema,
  updatedAt: contentTimestampSchema,
});
export const adminOrdersLineSchema = z.strictObject({
  itemId: uuid,
  position: z.number().int().min(1).max(500),
  fulfillmentId: uuid,
  fulfillmentVersion: checkoutVersionSchema,
  intentVersion: checkoutVersionSchema,
  hasMessage: z.boolean(),
  hasDisplayName: z.boolean(),
  declaredLocale: z.union([supportedLocaleSchema, z.literal("und")]),
  languageConfidence: z.enum(["UNVERIFIED", "LOW", "CONFIRMED"]),
  reviewedLocale: supportedLocaleSchema.nullable(),
  moderationStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "REDACTED"]),
  privacyState: z.enum(["ACTIVE", "PURGE_PENDING", "PURGED"]),
  giftKind: z.union([giftKindSchema, z.literal("LEGACY")]),
  inventoryPolicy: z.enum([
    "TRACKED",
    "PROCURE_ON_DEMAND",
    "PREORDER",
    "LEGACY",
  ]),
  allowedActions: z
    .array(z.enum(["PREPARE", "DELIVER", "HOLD", "RESUME"]))
    .max(4),
});
export const adminOrdersNoteMetadataSchema = z.strictObject({
  noteId: uuid,
  actorId: uuid,
  createdAt: contentTimestampSchema,
});
export const adminOrdersNotificationSchema = z.strictObject({
  latestNotificationId: uuid.nullable(),
  eventType: z.enum(["PAYMENT_CONFIRMED", "PREPARING", "DELIVERED"]).nullable(),
  status: z.enum([
    "NONE",
    "REQUESTED",
    "PROCESSING",
    "RETRY_SCHEDULED",
    "SENT",
    "FAILED",
    "UNKNOWN",
  ]),
  canResend: z.boolean(),
});
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const adminOrdersMutationResponseSchema = z.strictObject({
  ...success,
  kind: z.literal("MUTATION"),
  orderId: uuid,
  resultId: uuid,
  replayed: z.boolean(),
});
/** Ordinary responses never carry private message, display-name, note or contact plaintext. */
export const adminOrdersResponseSchema = z.union([
  adminOrdersFailureSchema,
  z.strictObject({
    ...success,
    kind: z.literal("CONTEXT"),
    actorId: uuid,
    permissions: z
      .array(adminOrdersPermissionSchema)
      .max(8)
      .refine((v) => new Set(v).size === v.length),
    reviewLocales: z
      .array(supportedLocaleSchema)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("LIST"),
    ...pagination,
    totalItems: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    items: z.array(adminOrdersListItemSchema).max(50),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("DETAIL"),
    orderId: uuid,
    version: checkoutVersionSchema,
    order: orderAccessDetailSchema,
    items: z.array(adminOrdersLineSchema).min(1).max(500),
    notes: z.array(adminOrdersNoteMetadataSchema).max(50),
    notification: adminOrdersNotificationSchema,
  }),
  adminOrdersMutationResponseSchema,
]);
export const adminOrdersPrivateResponseSchema = z.union([
  adminOrdersFailureSchema,
  z.strictObject({
    ...success,
    kind: z.literal("MESSAGE"),
    orderId: uuid,
    itemId: uuid,
    intentVersion: checkoutVersionSchema,
    accessId: uuid,
    expiresAt: contentTimestampSchema,
    reviewLocale: supportedLocaleSchema,
    content: cartEditorContentSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("NOTES"),
    orderId: uuid,
    notes: z
      .array(adminOrdersNoteMetadataSchema.extend({ text: checkoutText(1000) }))
      .max(50),
  }),
]);
export type AdminOrdersPermission = z.infer<typeof adminOrdersPermissionSchema>;
export type AdminOrdersCommand = z.infer<typeof adminOrdersCommandSchema>;
export type AdminOrdersRequest = z.infer<typeof adminOrdersRequestSchema>;
export type AdminOrdersResponse = z.infer<typeof adminOrdersResponseSchema>;
export type AdminOrdersPrivateResponse = z.infer<
  typeof adminOrdersPrivateResponseSchema
>;
export type AdminOrdersFailure = z.infer<typeof adminOrdersFailureSchema>;
export type AdminOrdersListItem = z.infer<typeof adminOrdersListItemSchema>;
export type AdminOrdersLine = z.infer<typeof adminOrdersLineSchema>;
export type AdminOrdersMutationResponse = z.infer<
  typeof adminOrdersMutationResponseSchema
>;
