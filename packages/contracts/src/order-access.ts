import { z } from "zod";
import {
  cartRuntimeAccessesSchema,
  cartRuntimeQuantitySchema,
} from "./cart-runtime.js";
import {
  currencySchema,
  keyVersionSchema,
  minorAmountSchema,
} from "./commerce.js";
import { checkoutText } from "./checkout-preflight.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { canonicalRequestIdSchema } from "./envelopes.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import {
  checkoutSessionIdSchema,
  orderIdSchema,
  publicOrderIdSchema,
  publicOrderNoSchema,
} from "./identifiers.js";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "./locale.js";
import {
  disputeStatusSchema,
  fulfillmentStatusSchema,
  orderStatusSchema,
  publicOrderAmountViewSchema,
} from "./order.js";
import { orderPaymentStatusSchema } from "./payment.js";
import { publicMediaUrlSchema, slugSchema } from "./presentation.js";
import { paymentRuntimeOriginSchema } from "./payment-runtime-config.js";

const version = z.literal(1);
const sessionTtl = z.number().int().min(1).max(86_400);
const linkTtl = z.number().int().min(1).max(604_800);
const requestTrace = {
  requestId: canonicalRequestIdSchema,
  correlationId: canonicalRequestIdSchema,
  taskName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u),
};
export const orderAccessCredentialSchema = z.strictObject({
  schemaVersion: version,
  tokenDigest: sourceHashSchema,
  pepperVersion: keyVersionSchema,
});
export const orderAccessCandidatesSchema = z
  .array(orderAccessCredentialSchema)
  .min(1)
  .max(4)
  .refine(
    (values) =>
      new Set(values.map((value) => value.pepperVersion)).size ===
      values.length,
  );
/** Exactly 256 bits. Final base64url character has two zero padding bits. Raw values stop at transport. */
export const orderAccessRawTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
export const orderAccessExchangeRequestSchema = z.strictObject({
  schemaVersion: version,
  token: orderAccessRawTokenSchema,
});
export const orderAccessBootstrapRequestSchema = z.strictObject({
  schemaVersion: version,
});
export const orderAccessRevokeRequestSchema = z.strictObject({
  schemaVersion: version,
  publicOrderId: publicOrderIdSchema,
});
/** Finds the order behind a typed public number; only this browser's order session can answer. */
export const orderAccessLocateRequestSchema = z.strictObject({
  schemaVersion: version,
  publicOrderNo: publicOrderNoSchema,
});
export const orderAccessIssueCommandSchema = z.strictObject({
  schemaVersion: version,
  orderId: orderIdSchema,
  tokenCredential: orderAccessCredentialSchema,
  linkTtlSeconds: linkTtl,
  ...requestTrace,
});
export const orderAccessExchangeCommandSchema = z.strictObject({
  schemaVersion: version,
  tokenCandidates: orderAccessCandidatesSchema,
  sessionCredential: orderAccessCredentialSchema,
  sessionTtlSeconds: sessionTtl,
  ...requestTrace,
});
export const orderAccessBootstrapCommandSchema = z.strictObject({
  schemaVersion: version,
  checkoutSessionId: checkoutSessionIdSchema,
  cartAccesses: cartRuntimeAccessesSchema,
  tokenCredential: orderAccessCredentialSchema,
  sessionCredential: orderAccessCredentialSchema,
  sessionTtlSeconds: sessionTtl,
  ...requestTrace,
});
export const orderAccessReadCommandSchema = z.strictObject({
  schemaVersion: version,
  publicOrderId: publicOrderIdSchema,
  sessionCandidates: orderAccessCandidatesSchema,
});
export const orderAccessRevokeCommandSchema = z.strictObject({
  ...orderAccessReadCommandSchema.shape,
  ...requestTrace,
});
export const orderAccessLocateCommandSchema = z.strictObject({
  schemaVersion: version,
  publicOrderNo: publicOrderNoSchema,
  sessionCandidates: orderAccessCandidatesSchema,
});
export const orderAccessGrantSchema = z.strictObject({
  schemaVersion: version,
  publicOrderId: publicOrderIdSchema,
  expiresAt: contentTimestampSchema,
});
export const orderAccessRevokedSchema = z.strictObject({
  schemaVersion: version,
  publicOrderId: publicOrderIdSchema,
});
export const orderAccessLocatedSchema = z.strictObject({
  schemaVersion: version,
  publicOrderId: publicOrderIdSchema,
});
export const orderAccessFailureCodeSchema = z.enum([
  "INVALID_REQUEST",
  "ACCESS_DENIED",
  "PAYMENT_NOT_CONFIRMED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
]);
export const orderAccessFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: orderAccessFailureCodeSchema,
});

const locale = {
  schemaVersion: version,
  requestedLocale: supportedLocaleSchema,
  resolvedLocale: supportedLocaleSchema,
  fallbackUsed: z.boolean(),
};
/** Minimal historical language provenance: no internal revision IDs and no manufactured translation. */
export const orderAccessLocaleSchema = z.discriminatedUnion("mode", [
  z
    .strictObject({ ...locale, mode: z.literal("APPROVED") })
    .refine((value) =>
      value.fallbackUsed
        ? value.requestedLocale !== DEFAULT_LOCALE &&
          value.resolvedLocale === DEFAULT_LOCALE
        : value.requestedLocale === value.resolvedLocale,
    ),
  z
    .strictObject({
      ...locale,
      mode: z.literal("DAILY"),
      sourceLocale: supportedLocaleSchema,
    })
    .refine(
      (value) =>
        value.resolvedLocale === value.sourceLocale &&
        value.fallbackUsed === (value.requestedLocale !== value.sourceLocale),
    ),
]);
export const orderAccessMediaSchema = z.strictObject({
  url: publicMediaUrlSchema,
  alt: checkoutText(300),
  locale: orderAccessLocaleSchema,
});
export const orderAccessItemSchema = z
  .strictObject({
    schemaVersion: version,
    position: z.number().int().min(1).max(500),
    idol: z.strictObject({
      handle: slugSchema,
      displayName: checkoutText(40),
      locale: orderAccessLocaleSchema,
      portrait: orderAccessMediaSchema,
    }),
    gift: z.strictObject({
      title: checkoutText(160),
      variantLabel: checkoutText(80).nullable(),
      locale: orderAccessLocaleSchema,
      image: orderAccessMediaSchema,
    }),
    quantity: cartRuntimeQuantitySchema,
    unitAmountMinor: minorAmountSchema,
    lineSubtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
    currency: currencySchema,
    displayMode: z.enum(["anonymous", "nickname"]),
    /** Purchase-time classification snapshot; null only for pre-profile legacy lines (ADR-019). */
    giftKind: giftKindSchema.nullable(),
    fulfillmentStatus: fulfillmentStatusSchema,
  })
  .refine(
    (value) =>
      BigInt(value.unitAmountMinor) * BigInt(value.quantity) ===
        BigInt(value.lineSubtotalMinor) &&
      BigInt(value.lineSubtotalMinor) +
        BigInt(value.taxAmountMinor) -
        BigInt(value.discountAmountMinor) ===
        BigInt(value.lineTotalMinor),
  );
export const orderAccessDetailSchema = z
  .strictObject({
    schemaVersion: version,
    publicOrderId: publicOrderIdSchema,
    /** Fan-facing number; publicOrderId stays in URLs and APIs. */
    publicOrderNo: publicOrderNoSchema,
    presentationLocale: supportedLocaleSchema,
    orderStatus: orderStatusSchema,
    paymentStatus: orderPaymentStatusSchema,
    disputeStatus: disputeStatusSchema,
    fulfillmentStatus: fulfillmentStatusSchema,
    amount: publicOrderAmountViewSchema,
    items: z.array(orderAccessItemSchema).min(1).max(500),
    createdAt: contentTimestampSchema,
    updatedAt: contentTimestampSchema,
  })
  .superRefine((order, context) => {
    const sum = (
      field:
        | "lineSubtotalMinor"
        | "taxAmountMinor"
        | "discountAmountMinor"
        | "lineTotalMinor",
    ) => order.items.reduce((result, item) => result + BigInt(item[field]), 0n);
    if (
      order.items.some(
        (item, index) =>
          item.position !== index + 1 ||
          item.currency !== order.amount.currency ||
          [
            item.idol.locale,
            item.idol.portrait.locale,
            item.gift.locale,
            item.gift.image.locale,
          ].some(
            (language) => language.requestedLocale !== order.presentationLocale,
          ),
      ) ||
      sum("lineSubtotalMinor") !== BigInt(order.amount.subtotalMinor) ||
      sum("taxAmountMinor") !== BigInt(order.amount.taxAmountMinor) ||
      sum("discountAmountMinor") !== BigInt(order.amount.discountAmountMinor) ||
      sum("lineTotalMinor") +
        BigInt(order.amount.shippingAmountMinor) +
        BigInt(order.amount.feeAmountMinor) !==
        BigInt(order.amount.totalAmountMinor)
    )
      context.addIssue({
        code: "custom",
        message: "Historical order amounts, positions and languages must agree",
      });
  });
export const orderAccessResponseSchema = z.union([
  orderAccessFailureSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    action: z.literal("GRANTED"),
    grant: orderAccessGrantSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    action: z.literal("READ"),
    order: orderAccessDetailSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    action: z.literal("REVOKED"),
    publicOrderId: publicOrderIdSchema,
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    action: z.literal("LOCATED"),
    publicOrderId: publicOrderIdSchema,
  }),
]);
export const orderAccessRateCommandSchema = z.strictObject({
  schemaVersion: version,
  scope: z.enum(["EXCHANGE", "BOOTSTRAP", "READ", "REVOKE"]),
  bucket: orderAccessCredentialSchema,
  windowSeconds: z.number().int().min(1).max(3600),
  maxRequests: z.number().int().min(1).max(10_000),
});
export const orderAccessRateResultSchema = z
  .strictObject({
    schemaVersion: version,
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(0).max(3600),
  })
  .refine((value) =>
    value.allowed ? value.retryAfterSeconds === 0 : value.retryAfterSeconds > 0,
  );
const rateMax = z.number().int().min(1).max(10_000);
export const orderAccessConfigurationSchema = z.strictObject({
  schemaVersion: version,
  publicStorefrontOrigin: paymentRuntimeOriginSchema,
  sessionTtlSeconds: sessionTtl,
  linkTtlSeconds: linkTtl,
  rateLimit: z.strictObject({
    windowSeconds: z.number().int().min(1).max(3600),
    exchangeMax: rateMax,
    bootstrapMax: rateMax,
    readMax: rateMax,
    revokeMax: rateMax,
  }),
});

export type OrderAccessCredential = z.infer<typeof orderAccessCredentialSchema>;
export type OrderAccessCandidates = z.infer<typeof orderAccessCandidatesSchema>;
export type OrderAccessIssueCommand = z.infer<
  typeof orderAccessIssueCommandSchema
>;
export type OrderAccessExchangeCommand = z.infer<
  typeof orderAccessExchangeCommandSchema
>;
export type OrderAccessBootstrapCommand = z.infer<
  typeof orderAccessBootstrapCommandSchema
>;
export type OrderAccessReadCommand = z.infer<
  typeof orderAccessReadCommandSchema
>;
export type OrderAccessRevokeCommand = z.infer<
  typeof orderAccessRevokeCommandSchema
>;
export type OrderAccessLocateCommand = z.infer<
  typeof orderAccessLocateCommandSchema
>;
export type OrderAccessLocated = z.infer<typeof orderAccessLocatedSchema>;
export type OrderAccessGrant = z.infer<typeof orderAccessGrantSchema>;
export type OrderAccessRevoked = z.infer<typeof orderAccessRevokedSchema>;
export type OrderAccessFailureCode = z.infer<
  typeof orderAccessFailureCodeSchema
>;
export type OrderAccessDetail = z.infer<typeof orderAccessDetailSchema>;
export type OrderAccessItem = z.infer<typeof orderAccessItemSchema>;
export type OrderAccessLocale = z.infer<typeof orderAccessLocaleSchema>;
export type OrderAccessResponse = z.infer<typeof orderAccessResponseSchema>;
export type OrderAccessRateCommand = z.infer<
  typeof orderAccessRateCommandSchema
>;
export type OrderAccessRateResult = z.infer<typeof orderAccessRateResultSchema>;
export type OrderAccessConfiguration = z.infer<
  typeof orderAccessConfigurationSchema
>;
