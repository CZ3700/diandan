import { z } from "zod";
import {
  currencySchema,
  encryptedValueSchema,
  keyVersionSchema,
  minorAmountSchema,
} from "./commerce.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  notificationCommandSchema,
  notificationLocaleSnapshotSchema,
} from "./fulfillment-notification.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  notificationPortCommandSchema,
  notificationPortResponseSchema,
} from "./notification-port-contracts.js";
import {
  orderAccessCredentialSchema,
  orderAccessGrantSchema,
  orderAccessRawTokenSchema,
} from "./order-access.js";
import { paymentRuntimeOriginSchema } from "./payment-runtime-config.js";

const version = z.literal(1);
const id = z.uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const text = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (v) =>
      ![...v].some((character) => {
        const point = character.charCodeAt(0);
        return point < 32 || point === 127;
      }),
  );
const taskName = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u)
  .max(128);
export const orderNotificationEventTypeSchema =
  notificationCommandSchema.shape.eventType;
export const orderNotificationItemSchema = z
  .strictObject({
    idolName: text,
    idolLocale: supportedLocaleSchema,
    giftName: text,
    giftLocale: supportedLocaleSchema,
    variantName: text.nullable(),
    variantLocale: supportedLocaleSchema.nullable(),
    quantity: z.number().int().min(1).max(2_147_483_647),
    lineTotalMinor: minorAmountSchema,
  })
  .refine((v) => (v.variantName === null) === (v.variantLocale === null));
/** No live catalog lookup or private support-intent fields. Frozen before sending. */
export const orderNotificationBaseVariablesSchema = z.strictObject({
  schemaVersion: version,
  siteName: text.max(120),
  publicOrderId: id,
  orderedAt: contentTimestampSchema,
  currency: currencySchema,
  totalMinor: minorAmountSchema,
  items: z.array(orderNotificationItemSchema).min(1).max(500),
});
export const orderNotificationUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search
      )
        return false;
      const match = /^\/([^/]+)\/order-access$/u.exec(url.pathname);
      const fragment = /^#token=([^&]+)&order=([^&]+)$/u.exec(url.hash);
      return Boolean(
        match &&
        supportedLocaleSchema.safeParse(match[1]).success &&
        fragment &&
        orderAccessRawTokenSchema.safeParse(fragment[1]).success &&
        id.safeParse(fragment[2]).success,
      );
    } catch {
      return false;
    }
  }, "Order credentials must use the HTTPS exchange fragment only");
export const orderNotificationVariablesSchema =
  orderNotificationBaseVariablesSchema.extend({
    orderUrl: orderNotificationUrlSchema,
  });
export const orderNotificationTemplateSelectionSchema = z
  .strictObject({
    schemaVersion: version,
    eventType: orderNotificationEventTypeSchema,
    requestedLocale: supportedLocaleSchema,
    resolvedLocale: supportedLocaleSchema,
    fallbackUsed: z.boolean(),
    templateKey: z.enum([
      "order.payment.confirmed",
      "order.preparing",
      "order.delivered",
    ]),
    templateVersion: z.string().regex(/^v[1-9][0-9]*\.[a-f0-9]{64}$/u),
    fallbackReasonCode: code.optional(),
  })
  .superRefine((v, ctx) => {
    const expected = {
      PAYMENT_CONFIRMED: "order.payment.confirmed",
      PREPARING: "order.preparing",
      DELIVERED: "order.delivered",
    }[v.eventType];
    if (
      v.templateKey !== expected ||
      (v.fallbackUsed
        ? v.requestedLocale === "en" ||
          v.resolvedLocale !== "en" ||
          v.fallbackReasonCode === undefined
        : v.requestedLocale !== v.resolvedLocale ||
          v.fallbackReasonCode !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Template event and whole-message fallback identity must agree",
      });
  });
export const orderNotificationRenderCommandSchema = z.strictObject({
  schemaVersion: version,
  eventType: orderNotificationEventTypeSchema,
  locale: notificationLocaleSnapshotSchema,
  variables: orderNotificationVariablesSchema,
});
export const orderNotificationContentSchema =
  notificationPortCommandSchema.shape.content.required();
/** Recipient and credential-bearing content are transient adapter input, never queue or persistence material. */
export const notificationEmailDispatchSchema =
  notificationPortCommandSchema.extend({
    recipient: z.email().max(254),
    /** Immutable receiver-enforced cutoff. After it, only a stored receipt may be returned. */
    dispatchNotAfter: contentTimestampSchema,
  });
export const notificationGatewayProfileSchema = z.strictObject({
  schemaVersion: version,
  protocol: z.literal("fan-support-mail-v1"),
  environment: z.enum(["TEST", "LIVE"]),
  apiOrigin: paymentRuntimeOriginSchema,
  fromEmail: z.email().max(254),
  fromName: text.max(120),
  replyToEmail: z.email().max(254),
  timeoutMs: z.number().int().min(100).max(10000),
  idempotencyRetentionSeconds: z.number().int().min(60).max(604800),
});
export const notificationGatewayReceiptSchema = z.strictObject({
  schemaVersion: version,
  protocol: z.literal("fan-support-mail-v1"),
  profileHash: sourceHashSchema,
  notificationId: id,
  idempotencyKey: z.string().min(1).max(256),
  requestHash: sourceHashSchema,
  result: notificationPortResponseSchema,
});
export type NotificationGatewayProfile = z.infer<
  typeof notificationGatewayProfileSchema
>;
export const notificationTemplateReviewSchema = z
  .strictObject({
    schemaVersion: version,
    locale: supportedLocaleSchema,
    templateVersion: z.string().regex(/^v[1-9][0-9]*\.[a-f0-9]{64}$/u),
    sourceHash: sourceHashSchema,
    translationHash: sourceHashSchema,
    variablesHash: sourceHashSchema,
    translator: z.string().min(1).max(128),
    reviewer: z.string().min(1).max(128).nullable(),
    status: z.enum(["DRAFT", "APPROVED"]),
    approvedCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
  })
  .refine((v) =>
    v.status === "DRAFT"
      ? v.reviewer === null && v.approvedCommit === null
      : v.reviewer !== null && v.approvedCommit !== null,
  );

export const notificationSourceCommandSchema = z.strictObject({
  schemaVersion: version,
  outboxEventId: id,
});
export const notificationSourceResultSchema = z.discriminatedUnion("decision", [
  z.strictObject({ schemaVersion: version, decision: z.literal("IGNORED") }),
  z.strictObject({
    schemaVersion: version,
    decision: z.literal("READY"),
    eventType: orderNotificationEventTypeSchema,
    requestedLocale: supportedLocaleSchema,
  }),
]);
export const notificationRequestCommandSchema = z.strictObject({
  schemaVersion: version,
  outboxEventId: id,
  notificationId: id,
  selection: orderNotificationTemplateSelectionSchema,
  siteName: text.max(120),
  publicStorefrontOrigin: paymentRuntimeOriginSchema,
  transportKey: sourceHashSchema,
  linkNonce: sourceHashSchema,
  linkPepperVersion: keyVersionSchema,
  linkTtlSeconds: z.number().int().min(1).max(604800),
  idempotencyRetentionSeconds: z.number().int().min(60).max(604800),
});
export const notificationRequestResultSchema = z.discriminatedUnion(
  "decision",
  [
    z.strictObject({ schemaVersion: version, decision: z.literal("IGNORED") }),
    z.strictObject({
      schemaVersion: version,
      decision: z.enum(["CREATED", "REPLAY"]),
      notificationId: id,
      fallbackUsed: z.boolean(),
    }),
  ],
);
export const notificationLeaseCommandSchema = z.strictObject({
  schemaVersion: version,
  notificationId: id,
  leaseToken: id,
});
export const notificationClaimCommandSchema =
  notificationLeaseCommandSchema.extend({
    leaseSeconds: z.number().int().min(1).max(600),
    maxAttempts: z.number().int().min(1).max(6),
  });
export const notificationDeliveryPlanSchema = z.strictObject({
  schemaVersion: version,
  notification: notificationCommandSchema,
  baseVariables: orderNotificationBaseVariablesSchema,
  publicStorefrontOrigin: paymentRuntimeOriginSchema,
  transportKey: sourceHashSchema,
  linkNonce: sourceHashSchema,
  linkPepperVersion: keyVersionSchema,
  linkTtlSeconds: z.number().int().min(1).max(604800),
  dedupeUntil: contentTimestampSchema,
  leaseToken: id,
  attemptNumber: z.number().int().min(1).max(6),
});
export const notificationClaimResultSchema = z.discriminatedUnion("decision", [
  z.strictObject({ schemaVersion: version, decision: z.literal("SKIP") }),
  z.strictObject({ schemaVersion: version, decision: z.literal("FAILED") }),
  z.strictObject({
    schemaVersion: version,
    decision: z.literal("READY"),
    plan: notificationDeliveryPlanSchema,
  }),
]);
export const notificationAttachLinkCommandSchema =
  notificationLeaseCommandSchema.extend({
    credential: orderAccessCredentialSchema,
  });
export const notificationAttachLinkResultSchema = orderAccessGrantSchema;
export const notificationRecipientResultSchema = z.strictObject({
  schemaVersion: version,
  customerContactId: id,
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
  algorithm: z.literal("AES_256_GCM"),
});
export const notificationConfirmSendCommandSchema =
  notificationLeaseCommandSchema.extend({ contentHash: sourceHashSchema });
export const notificationConfirmSendResultSchema = z.strictObject({
  schemaVersion: version,
  decision: z.enum(["READY", "SKIP", "FAILED"]),
});
export const notificationFinishCommandSchema =
  notificationLeaseCommandSchema.extend({
    result: notificationPortResponseSchema,
    retryDelaySeconds: z.number().int().min(1).max(86400),
    maxAttempts: z.number().int().min(1).max(6),
  });
export const notificationFinishResultSchema = z.strictObject({
  schemaVersion: version,
  decision: z.enum(["SENT", "RETRY_SCHEDULED", "FAILED", "SKIP"]),
});
export const notificationListPendingCommandSchema = z.strictObject({
  schemaVersion: version,
  limit: z.number().int().min(1).max(100),
});
export const notificationListPendingResultSchema = z.strictObject({
  schemaVersion: version,
  notificationIds: z.array(id).max(100),
});
export const notificationRunResultSchema = z.strictObject({
  schemaVersion: version,
  scanned: count,
  sent: count,
  scheduled: count,
  failed: count,
  skipped: count,
});
export const notificationRuntimeConfigurationSchema = z.strictObject({
  schemaVersion: version,
  siteName: text.max(120),
  publicStorefrontOrigin: paymentRuntimeOriginSchema,
  transportKey: sourceHashSchema,
  linkPepperVersion: keyVersionSchema,
  linkTtlSeconds: z.number().int().min(1).max(604800),
  idempotencyRetentionSeconds: z.number().int().min(60).max(604800),
  leaseSeconds: z.number().int().min(30).max(600),
  retryDelaySeconds: z.number().int().min(1).max(86400),
  maxAttempts: z.number().int().min(1).max(6),
});
export type NotificationRuntimeConfiguration = z.infer<
  typeof notificationRuntimeConfigurationSchema
>;

export const commerceExpiryListCommandSchema = z.strictObject({
  schemaVersion: version,
  limit: z.number().int().min(1).max(100),
});
export const commerceExpiryListResultSchema = z.strictObject({
  schemaVersion: version,
  cartIds: z.array(id).max(100),
});
export const commerceExpiryCommandSchema = z.strictObject({
  schemaVersion: version,
  cartId: id,
  requestId: id,
  correlationId: id,
  taskName,
});
export const commerceExpiryResultSchema = z.strictObject({
  schemaVersion: version,
  decision: z.enum(["APPLIED", "NOT_DUE", "BUSY", "DEFERRED"]),
  expiredReservations: count,
  expiredIntents: count,
  expiredCart: z.boolean(),
  expiredTokens: count,
  expiredSessions: count,
  canceledOrders: count,
  canceledIntents: count,
  expiredCheckoutSessions: count,
});

export type OrderNotificationEventType = z.infer<
  typeof orderNotificationEventTypeSchema
>;
export type OrderNotificationBaseVariables = z.infer<
  typeof orderNotificationBaseVariablesSchema
>;
export type OrderNotificationVariables = z.infer<
  typeof orderNotificationVariablesSchema
>;
export type OrderNotificationTemplateSelection = z.infer<
  typeof orderNotificationTemplateSelectionSchema
>;
export type OrderNotificationRenderCommand = z.infer<
  typeof orderNotificationRenderCommandSchema
>;
export type OrderNotificationContent = z.infer<
  typeof orderNotificationContentSchema
>;
export type NotificationEmailDispatch = z.infer<
  typeof notificationEmailDispatchSchema
>;
export type NotificationTemplateReview = z.infer<
  typeof notificationTemplateReviewSchema
>;
export type NotificationSourceCommand = z.infer<
  typeof notificationSourceCommandSchema
>;
export type NotificationSourceResult = z.infer<
  typeof notificationSourceResultSchema
>;
export type NotificationRequestCommand = z.infer<
  typeof notificationRequestCommandSchema
>;
export type NotificationRequestResult = z.infer<
  typeof notificationRequestResultSchema
>;
export type NotificationLeaseCommand = z.infer<
  typeof notificationLeaseCommandSchema
>;
export type NotificationClaimCommand = z.infer<
  typeof notificationClaimCommandSchema
>;
export type NotificationDeliveryPlan = z.infer<
  typeof notificationDeliveryPlanSchema
>;
export type NotificationClaimResult = z.infer<
  typeof notificationClaimResultSchema
>;
export type NotificationAttachLinkCommand = z.infer<
  typeof notificationAttachLinkCommandSchema
>;
export type NotificationAttachLinkResult = z.infer<
  typeof notificationAttachLinkResultSchema
>;
export type NotificationRecipientResult = z.infer<
  typeof notificationRecipientResultSchema
>;
export type NotificationConfirmSendCommand = z.infer<
  typeof notificationConfirmSendCommandSchema
>;
export type NotificationConfirmSendResult = z.infer<
  typeof notificationConfirmSendResultSchema
>;
export type NotificationFinishCommand = z.infer<
  typeof notificationFinishCommandSchema
>;
export type NotificationFinishResult = z.infer<
  typeof notificationFinishResultSchema
>;
export type NotificationListPendingCommand = z.infer<
  typeof notificationListPendingCommandSchema
>;
export type NotificationListPendingResult = z.infer<
  typeof notificationListPendingResultSchema
>;
export type NotificationRunResult = z.infer<typeof notificationRunResultSchema>;
export type CommerceExpiryListCommand = z.infer<
  typeof commerceExpiryListCommandSchema
>;
export type CommerceExpiryListResult = z.infer<
  typeof commerceExpiryListResultSchema
>;
export type CommerceExpiryCommand = z.infer<typeof commerceExpiryCommandSchema>;
export type CommerceExpiryResult = z.infer<typeof commerceExpiryResultSchema>;

export const commerceExpiryRunResultSchema = z.strictObject({
  schemaVersion: version,
  scanned: count,
  applied: count,
  skipped: count,
  failed: count,
  expiredReservations: count,
  expiredIntents: count,
  canceledOrders: count,
  canceledIntents: count,
  expiredCarts: count,
  expiredTokens: count,
  expiredSessions: count,
  expiredCheckoutSessions: count,
});
