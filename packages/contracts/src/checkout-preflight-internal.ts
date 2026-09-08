import { z } from "zod";
import {
  cartRuntimeAccessesSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeQuantitySchema,
} from "./cart-runtime.js";
import {
  checkoutQuoteSchema,
  currencySchema,
  displayModeSchema,
  encryptedValueSchema,
  keyVersionSchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  policyKeySchema,
  policyKindSchema,
  policyTranslationFieldsSchema,
} from "./content-models.js";
import {
  cartIdSchema,
  cartItemIdSchema,
  checkoutSessionIdSchema,
  contentPublicationIdSchema,
  customerContactIdSchema,
  fulfillmentIdSchema,
  giftIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  inventoryItemIdSchema,
  orderIdSchema,
  orderItemIdSchema,
  policyRevisionIdSchema,
  policyTranslationRevisionIdSchema,
  priceIdSchema,
  publicOrderIdSchema,
  supportIntentIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLocationSchema,
} from "./pricing-inventory-content.js";
import { slugSchema } from "./presentation.js";
import {
  checkoutMediaSnapshotSchema,
  checkoutPreflightIdSchema,
  checkoutText,
  checkoutTranslationSnapshotSchema,
  checkoutVersionSchema,
} from "./checkout-preflight.js";

const uuid = z.uuid();
const uniqueIds = (values: readonly string[]) =>
  new Set(values.map((value) => value.toLowerCase())).size === values.length;
const identity = {
  schemaVersion: z.literal(1),
  accesses: cartRuntimeAccessesSchema,
  cartId: cartIdSchema,
};
export const checkoutPreflightLoadCurrentCommandSchema = z.strictObject({
  ...identity,
  expectedCartVersion: checkoutVersionSchema,
  presentationLocale: supportedLocaleSchema,
});
/** Verified current facts only. Missing/expired/proof-invalid active lines cause a failure, never omission. */
export const checkoutPreflightLineFactsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cartItemId: cartItemIdSchema,
    itemVersion: checkoutVersionSchema,
    supportIntentId: supportIntentIdSchema,
    intentVersion: checkoutVersionSchema,
    fulfillmentProfileId: uuid,
    idolId: idolIdSchema,
    idolHandle: slugSchema,
    idolDisplayName: checkoutText(40),
    idolTranslation: checkoutTranslationSnapshotSchema,
    idolPortrait: checkoutMediaSnapshotSchema,
    giftId: giftIdSchema,
    giftVariantId: giftVariantIdSchema,
    giftTitle: checkoutText(160),
    giftVariantLabel: checkoutText(80),
    giftTranslation: checkoutTranslationSnapshotSchema,
    giftImage: checkoutMediaSnapshotSchema,
    observedPriceId: priceIdSchema,
    priceId: priceIdSchema,
    priceRevision: checkoutVersionSchema,
    unitAmountMinor: minorAmountSchema,
    quantity: cartRuntimeQuantitySchema,
    displayMode: displayModeSchema,
    inventoryPolicy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
    inventoryItemId: inventoryItemIdSchema.nullable(),
    eligibility: z.enum(["EXPLICIT", "ALL_ACTIVE_ARTISTS"]),
  })
  .refine(
    (value) =>
      value.inventoryPolicy !== "TRACKED" || value.inventoryItemId !== null,
  );
export const checkoutPreflightPolicyFactsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyKey: policyKeySchema,
  kind: policyKindSchema,
  locale: supportedLocaleSchema,
  policyRevisionId: policyRevisionIdSchema,
  policyTranslationRevisionId: policyTranslationRevisionIdSchema,
  publicationId: contentPublicationIdSchema,
  manifestHash: sourceHashSchema,
  sourceHash: sourceHashSchema,
  title: policyTranslationFieldsSchema.shape.title,
  body: policyTranslationFieldsSchema.shape.body,
  effectiveAt: contentTimestampSchema,
});
export const checkoutPreflightInventoryFactsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cartItemId: cartItemIdSchema,
    inventoryItem: inventoryItemSchema,
    locations: z
      .array(
        z.strictObject({
          location: inventoryLocationSchema,
          balance: inventoryBalanceSchema,
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((value, context) => {
    if (
      !uniqueIds(value.locations.map((entry) => entry.location.id)) ||
      value.locations.some(
        (entry) =>
          entry.location.id.toLowerCase() !==
            entry.balance.inventoryLocationId.toLowerCase() ||
          value.inventoryItem.id.toLowerCase() !==
            entry.balance.inventoryItemId.toLowerCase(),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Inventory locations must bind each actual item balance exactly once",
      });
  });
export const checkoutPreflightConsentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cartId: cartIdSchema,
    cartVersion: checkoutVersionSchema,
    presentationLocale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    lines: z.array(checkoutPreflightLineFactsSchema).min(1).max(500),
    policies: z.array(checkoutPreflightPolicyFactsSchema).min(1).max(500),
  })
  .superRefine((value, context) => {
    if (
      !uniqueIds(value.lines.map((line) => line.cartItemId)) ||
      !uniqueIds(value.lines.map((line) => line.supportIntentId)) ||
      new Set(value.policies.map((policy) => policy.policyKey)).size !==
        value.policies.length ||
      value.policies.some(
        (policy) => policy.locale !== value.presentationLocale,
      ) ||
      value.lines.some((line) =>
        [
          line.idolTranslation,
          line.giftTranslation,
          line.idolPortrait.altTranslation,
          line.giftImage.altTranslation,
        ].some((ref) => ref.requestedLocale !== value.presentationLocale),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Consent must cover unique complete lines and policies in the exact presentation locale",
      });
  });
/** Current stock counts are deliberately outside consent; they are locked and rechecked at create. */
export const checkoutPreflightCurrentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cart: cartRuntimeHeaderSchema,
    evaluatedAt: contentTimestampSchema,
    consent: checkoutPreflightConsentSchema,
    inventory: z.array(checkoutPreflightInventoryFactsSchema).max(500),
  })
  .superRefine((value, context) => {
    const tracked = value.consent.lines.filter(
      (line) => line.inventoryPolicy === "TRACKED",
    );
    if (
      value.cart.id.toLowerCase() !== value.consent.cartId.toLowerCase() ||
      value.cart.version !== value.consent.cartVersion ||
      value.cart.market !== value.consent.market ||
      value.cart.currency !== value.consent.currency ||
      !uniqueIds(value.inventory.map((entry) => entry.cartItemId)) ||
      value.inventory.length !== tracked.length ||
      tracked.some(
        (line) =>
          !value.inventory.some(
            (entry) =>
              entry.cartItemId.toLowerCase() ===
                line.cartItemId.toLowerCase() &&
              entry.inventoryItem.id.toLowerCase() ===
                line.inventoryItemId?.toLowerCase() &&
              entry.inventoryItem.giftVariantId.toLowerCase() ===
                line.giftVariantId.toLowerCase() &&
              entry.inventoryItem.policy === "TRACKED",
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Current cart, consent and tracked inventory must have exact ownership and cardinality",
      });
  });
export const checkoutPreflightObservationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: checkoutPreflightIdSchema,
    consentHash: sourceHashSchema,
    consent: checkoutPreflightConsentSchema,
    quote: checkoutQuoteSchema,
    createdAt: contentTimestampSchema,
    expiresAt: contentTimestampSchema,
  })
  .superRefine((value, context) => {
    const { consent, quote } = value;
    if (
      consent.cartVersion !== quote.cartVersion ||
      consent.market !== quote.amount.market ||
      consent.currency !== quote.amount.currency ||
      value.expiresAt !== quote.expiresAt ||
      Date.parse(value.createdAt) >= Date.parse(value.expiresAt) ||
      quote.lines.length !== consent.lines.length ||
      quote.lines.some((line, index) => {
        const item = consent.lines[index];
        return (
          !item ||
          line.cartItemId !== item.cartItemId ||
          line.giftVariantId !== item.giftVariantId ||
          line.priceId !== item.priceId ||
          line.priceRevision !== item.priceRevision ||
          line.quantity !== item.quantity ||
          line.unitAmountMinor !== item.unitAmountMinor
        );
      })
    )
      context.addIssue({
        code: "custom",
        message:
          "Observation quote must preserve every verified consent line, scope and expiry",
      });
  });
export const checkoutPreflightSaveCommandSchema = z
  .strictObject({
    ...identity,
    observation: checkoutPreflightObservationSchema,
  })
  .refine(
    (value) =>
      value.cartId.toLowerCase() ===
      value.observation.consent.cartId.toLowerCase(),
    { message: "Saved observation must belong to the authenticated cart" },
  );
export const checkoutPreflightFindCommandSchema = z.strictObject({
  ...identity,
  preflightId: checkoutPreflightIdSchema,
});
export const checkoutPreflightReadSessionCommandSchema = z.strictObject({
  ...identity,
  checkoutSessionId: checkoutSessionIdSchema,
});
export const checkoutEncryptedContactSchema = z.strictObject({
  id: customerContactIdSchema,
  emailCiphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  encryptionKeyVersion: keyVersionSchema,
  emailLookupHmac: sourceHashSchema,
  lookupKeyVersion: keyVersionSchema,
});
export const checkoutPreflightCommitCommandSchema = z
  .strictObject({
    ...identity,
    preflightId: checkoutPreflightIdSchema,
    expectedCartVersion: checkoutVersionSchema,
    expectedConsentHash: sourceHashSchema,
    checkoutSessionId: checkoutSessionIdSchema,
    orderId: orderIdSchema,
    publicOrderId: publicOrderIdSchema,
    contact: checkoutEncryptedContactSchema,
    items: z
      .array(
        z.strictObject({
          cartItemId: cartItemIdSchema,
          orderItemId: orderItemIdSchema,
          fulfillmentId: fulfillmentIdSchema,
          fulfillmentEventId: uuid,
        }),
      )
      .min(1)
      .max(500),
    createdOrderEventId: uuid,
    pendingOrderEventId: uuid,
    eventId: uuid,
    requestId: uuid,
    correlationId: uuid,
  })
  .refine(
    (value) =>
      uniqueIds(value.items.map((item) => item.cartItemId)) &&
      uniqueIds(value.items.map((item) => item.orderItemId)) &&
      uniqueIds(value.items.map((item) => item.fulfillmentId)) &&
      uniqueIds(value.items.map((item) => item.fulfillmentEventId)),
  );
export const checkoutPreflightReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preflightId: checkoutPreflightIdSchema,
  cartId: cartIdSchema,
  cartVersion: checkoutVersionSchema,
  checkoutSessionId: checkoutSessionIdSchema,
  orderId: orderIdSchema,
  publicOrderId: publicOrderIdSchema,
  occurredAt: contentTimestampSchema,
});
export const checkoutPreflightSessionRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    receipt: checkoutPreflightReceiptSchema,
    observation: checkoutPreflightObservationSchema,
    evaluatedAt: contentTimestampSchema,
    expired: z.boolean(),
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
  })
  .refine(
    (value) =>
      value.receipt.preflightId.toLowerCase() ===
        value.observation.id.toLowerCase() &&
      value.receipt.cartId.toLowerCase() ===
        value.observation.consent.cartId.toLowerCase(),
    {
      message: "Historical checkout receipt must bind its observation and cart",
    },
  );
export type CheckoutPreflightLoadCurrentCommand = z.infer<
  typeof checkoutPreflightLoadCurrentCommandSchema
>;
export type CheckoutPreflightLineFacts = z.infer<
  typeof checkoutPreflightLineFactsSchema
>;
export type CheckoutPreflightPolicyFacts = z.infer<
  typeof checkoutPreflightPolicyFactsSchema
>;
export type CheckoutPreflightInventoryFacts = z.infer<
  typeof checkoutPreflightInventoryFactsSchema
>;
export type CheckoutPreflightConsent = z.infer<
  typeof checkoutPreflightConsentSchema
>;
export type CheckoutPreflightCurrent = z.infer<
  typeof checkoutPreflightCurrentSchema
>;
export type CheckoutPreflightObservation = z.infer<
  typeof checkoutPreflightObservationSchema
>;
export type CheckoutPreflightSaveCommand = z.infer<
  typeof checkoutPreflightSaveCommandSchema
>;
export type CheckoutPreflightFindCommand = z.infer<
  typeof checkoutPreflightFindCommandSchema
>;
export type CheckoutPreflightReadSessionCommand = z.infer<
  typeof checkoutPreflightReadSessionCommandSchema
>;
export type CheckoutEncryptedContact = z.infer<
  typeof checkoutEncryptedContactSchema
>;
export type CheckoutPreflightCommitCommand = z.infer<
  typeof checkoutPreflightCommitCommandSchema
>;
export type CheckoutPreflightReceipt = z.infer<
  typeof checkoutPreflightReceiptSchema
>;
export type CheckoutPreflightSessionRecord = z.infer<
  typeof checkoutPreflightSessionRecordSchema
>;
