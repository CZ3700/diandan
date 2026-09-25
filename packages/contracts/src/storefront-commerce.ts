import { z } from "zod";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { policyKeySchema, policyKindSchema } from "./content-models.js";
import {
  publishedIdolViewSchema,
  publishedGiftViewSchema,
  giftVariantDefinitionSchema,
} from "./catalog-content.js";
import { lineAmountCalculationInputSchema } from "./domain-rules.js";
import {
  giftVariantIdSchema,
  idolIdSchema,
  priceIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  publishedGiftCommerceContextResponseSchema,
  publishedGiftCommerceResponseSchema,
} from "./published-gift-commerce.js";
import { publishedContentContextSchema } from "./published-content.js";
import { slugSchema } from "./presentation.js";

const version = z.literal(1);
const nonnegativeQuantity = z.union([
  z.literal(0),
  lineAmountCalculationInputSchema.shape.quantity,
]);
const unique = (values: readonly string[]) =>
  new Set(values.map((value) => value.toLowerCase())).size === values.length;

export const storefrontContextReadCommandSchema = z.strictObject({
  schemaVersion: version,
});
export const storefrontContextResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("STOREFRONT_CONTEXT"),
      markets: z
        .array(
          z.strictObject({
            market: marketSchema,
            currencies: z.array(currencySchema).min(1).max(100).refine(unique),
          }),
        )
        .max(500),
      policies: z
        .array(
          z.strictObject({
            policyKey: policyKeySchema,
            kind: policyKindSchema,
          }),
        )
        .max(500),
    })
    .superRefine((value, ctx) => {
      if (
        !unique(value.markets.map((item) => item.market)) ||
        !unique(value.policies.map((item) => item.policyKey))
      )
        ctx.addIssue({
          code: "custom",
          message: "public configuration identities must be unique",
        });
    }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("FAILURE"),
    code: z.enum(["INVALID_QUERY", "COMMERCE_UNAVAILABLE"]),
  }),
]);

export const storefrontGiftReadCommandSchema = z.strictObject({
  schemaVersion: version,
  handle: slugSchema,
  locale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
  idolId: idolIdSchema.optional(),
});
export const storefrontGiftFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_QUERY",
    "NOT_FOUND",
    "MARKET_UNAVAILABLE",
    "CONTENT_UNAVAILABLE",
  ]),
});
const noRecipient = z.strictObject({ kind: z.literal("NONE") });
const unavailableRecipient = z.strictObject({
  kind: z.literal("UNAVAILABLE"),
  idolId: idolIdSchema,
});
const idolFields = publishedIdolViewSchema.shape;
const recipientIdol = z
  .strictObject({
    schemaVersion: idolFields.schemaVersion,
    id: idolFields.id,
    handle: idolFields.handle,
    status: idolFields.status,
    acceptingGifts: idolFields.acceptingGifts,
    localeContext: idolFields.localeContext,
    displayName: idolFields.displayName,
    portrait: idolFields.portrait,
  })
  .refine((value) => !value.acceptingGifts || value.status === "active");
export const storefrontGiftRecipientSchema = z.discriminatedUnion("kind", [
  noRecipient,
  z.strictObject({ kind: z.literal("PUBLISHED"), idol: recipientIdol }),
  unavailableRecipient,
]);
export const storefrontGiftPriceSchema = z.strictObject({
  priceId: priceIdSchema,
  priceRevision: z.number().int().positive(),
  unitAmountMinor: minorAmountSchema,
});
export const storefrontGiftStockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TRACKED"),
    availableQuantity: nonnegativeQuantity,
  }),
  z.strictObject({ kind: z.literal("PROCURE_ON_DEMAND") }),
  z.strictObject({ kind: z.literal("PREORDER") }),
]);
export const storefrontGiftOfferSchema = z
  .strictObject({
    giftVariantId: giftVariantIdSchema,
    price: storefrontGiftPriceSchema.nullable(),
    availability: z.enum(["AVAILABLE", "PREORDER", "UNAVAILABLE"]),
    reason: z
      .enum([
        "GIFT_PAUSED",
        "VARIANT_PAUSED",
        "RECIPIENT_UNAVAILABLE",
        "NOT_ELIGIBLE",
        "NO_ELIGIBLE_RECIPIENT",
        "PRICE_UNAVAILABLE",
        "OUT_OF_STOCK",
        "INVENTORY_UNAVAILABLE",
      ])
      .nullable(),
    requiresRecipient: z.boolean(),
    stock: storefrontGiftStockSchema,
    maxQuantity: nonnegativeQuantity,
  })
  .superRefine((value, ctx) => {
    const unavailable = value.availability === "UNAVAILABLE";
    if (
      unavailable !== (value.reason !== null) ||
      unavailable !== (value.maxQuantity === 0) ||
      (!unavailable && value.price === null) ||
      (!unavailable &&
        (value.availability === "PREORDER") !==
          (value.stock.kind === "PREORDER")) ||
      (value.stock.kind === "TRACKED" &&
        value.maxQuantity > value.stock.availableQuantity)
    )
      ctx.addIssue({
        code: "custom",
        message: "offer price, availability and selectable quantity must agree",
      });
  });

export const storefrontGiftResponseSchema = z.union([
  publishedGiftCommerceResponseSchema.options[0]
    .extend({
      kind: z.literal("STOREFRONT_GIFT"),
      market: marketSchema,
      currency: currencySchema,
      recipient: storefrontGiftRecipientSchema,
      offers: z.array(storefrontGiftOfferSchema).min(1).max(64),
    })
    .superRefine((value, ctx) => {
      const variants = value.content.view.variants;
      if (
        variants.length !== value.offers.length ||
        !unique(value.offers.map((offer) => offer.giftVariantId)) ||
        value.offers.some((offer, index) => {
          const variant = variants[index];
          return (
            variant?.id.toLowerCase() !== offer.giftVariantId.toLowerCase() ||
            variant.inventoryPolicy !== offer.stock.kind ||
            offer.requiresRecipient !== (value.recipient.kind === "NONE") ||
            (offer.availability !== "UNAVAILABLE" &&
              (value.content.view.status !== "active" ||
                variant.status !== "active" ||
                value.recipient.kind === "UNAVAILABLE" ||
                (value.recipient.kind === "PUBLISHED" &&
                  (value.recipient.idol.status !== "active" ||
                    !value.recipient.idol.acceptingGifts))))
          );
        })
      )
        ctx.addIssue({
          code: "custom",
          path: ["offers"],
          message:
            "offers must bind the exact visible variants, recipient and current operating status",
        });
      if (
        value.recipient.kind === "PUBLISHED" &&
        value.recipient.idol.localeContext.requestedLocale !==
          value.content.view.localeContext.requestedLocale
      )
        ctx.addIssue({
          code: "custom",
          path: ["recipient"],
          message:
            "recipient and gift must share the requested presentation locale",
        });
    }),
  storefrontGiftFailureSchema,
]);

/** Current database facts, not authoring commands or a price/inventory publication snapshot. */
export const storefrontGiftVariantFactsSchema = z.strictObject({
  giftVariantId: giftVariantIdSchema,
  price: storefrontGiftPriceSchema.nullable(),
  hasEligibleRecipient: z.boolean(),
  eligibleForSelectedRecipient: z.boolean(),
  inventoryItem: z
    .strictObject({
      policy: giftVariantDefinitionSchema.shape.inventoryPolicy,
      status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
    })
    .nullable(),
  maximumLocationAvailableQuantity: nonnegativeQuantity,
});
/** Nested read-model boundary reused by the pure catalog projection. */
export const storefrontGiftOffersInputSchema = z.strictObject({
  schemaVersion: version,
  giftStatus: publishedGiftViewSchema.shape.status,
  recipient: storefrontGiftRecipientSchema,
  variants: publishedGiftViewSchema.shape.variants,
  facts: z.array(storefrontGiftVariantFactsSchema).max(64),
});
export const storefrontGiftContextResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      command: storefrontGiftReadCommandSchema,
      gift: publishedGiftCommerceContextResponseSchema.options[0],
      recipient: z.discriminatedUnion("kind", [
        noRecipient,
        unavailableRecipient,
        z.strictObject({
          kind: z.literal("PUBLISHED"),
          context: publishedContentContextSchema,
        }),
      ]),
      variants: z.array(storefrontGiftVariantFactsSchema).max(64),
    })
    .superRefine((value, ctx) => {
      if (!unique(value.variants.map((variant) => variant.giftVariantId)))
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: "variant facts must have unique identities",
        });
    }),
  storefrontGiftFailureSchema,
]);

export type StorefrontContextReadCommand = z.infer<
  typeof storefrontContextReadCommandSchema
>;
export type StorefrontContextResponse = z.infer<
  typeof storefrontContextResponseSchema
>;
export type StorefrontGiftReadCommand = z.infer<
  typeof storefrontGiftReadCommandSchema
>;
export type StorefrontGiftResponse = z.infer<
  typeof storefrontGiftResponseSchema
>;
export type StorefrontGiftContextResponse = z.infer<
  typeof storefrontGiftContextResponseSchema
>;
export type StorefrontGiftRecipient = z.infer<
  typeof storefrontGiftRecipientSchema
>;
export type StorefrontGiftOffer = z.infer<typeof storefrontGiftOfferSchema>;
export type StorefrontGiftVariantFacts = z.infer<
  typeof storefrontGiftVariantFactsSchema
>;
