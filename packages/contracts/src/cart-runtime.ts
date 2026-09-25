import { z } from "zod";

import {
  currencySchema,
  displayModeSchema,
  encryptedValueSchema,
  fanMessageLocaleSchema,
  keyVersionSchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import { contentLocaleContextSchema } from "./content-provenance.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  cartIdSchema,
  cartItemIdSchema,
  giftIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  priceIdSchema,
  supportIntentIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publishedMediaViewSchema } from "./media-content.js";
import { portKeyVersionSchema } from "./port-common.js";
import { slugSchema } from "./presentation.js";
import { storefrontGiftResponseSchema } from "./storefront-commerce.js";

const version = z.literal(1);
const positiveVersion = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const CART_RUNTIME_MAX_QUANTITY = 2_147_483_647;
export const cartRuntimeQuantitySchema = z
  .number()
  .int()
  .min(1)
  .max(CART_RUNTIME_MAX_QUANTITY);

/** Preserve original codepoints; malformed surrogate strings cannot cross PostgreSQL UTF-8. */
const privateText = (maximum: number) =>
  z
    .string()
    .max(maximum * 2)
    .refine((value) => {
      const characters = Array.from(value);
      return (
        characters.length > 0 &&
        characters.length <= maximum &&
        characters.every((character) => {
          const point = character.codePointAt(0)!;
          return point < 0xd800 || point > 0xdfff;
        })
      );
    }, "Text must contain valid Unicode codepoints within the field limit")
    .meta({
      minLength: 1,
      maxLength: maximum,
      "x-runtime-invariants": [
        "Text contains only valid Unicode scalar values; original codepoints are preserved",
      ],
    });

export const cartRuntimeInitializeCommandSchema = z.strictObject({
  schemaVersion: version,
  operation: z.literal("INITIALIZE_CART"),
  presentationLocale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
});
export const cartRuntimeReadCommandSchema = z.strictObject({
  schemaVersion: version,
  operation: z.literal("READ_CART"),
  presentationLocale: supportedLocaleSchema,
});
const addFields = {
  schemaVersion: version,
  operation: z.literal("ADD_CART_ITEM"),
  presentationLocale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
  idolId: idolIdSchema,
  giftId: giftIdSchema,
  giftVariantId: giftVariantIdSchema,
  quantity: cartRuntimeQuantitySchema,
  observedPriceId: priceIdSchema,
  fanMessageLocale: fanMessageLocaleSchema,
  fanMessage: privateText(280).optional(),
} as const;
export const cartRuntimeAddCommandSchema = z.discriminatedUnion("displayMode", [
  z.strictObject({ ...addFields, displayMode: z.literal("anonymous") }),
  z.strictObject({
    ...addFields,
    displayMode: z.literal("nickname"),
    displayName: privateText(40),
  }),
]);
export const cartRuntimeCommandSchema = z.union([
  cartRuntimeInitializeCommandSchema,
  cartRuntimeReadCommandSchema,
  cartRuntimeAddCommandSchema,
]);

export const cartRuntimeFailureCodeSchema = z.enum([
  "INVALID_COMMAND",
  "INVALID_ACCESS",
  "CART_NOT_FOUND",
  "CART_EXPIRED",
  "CART_LOCKED",
  "SCOPE_MISMATCH",
  "CONTENT_UNAVAILABLE",
  "COMMERCE_UNAVAILABLE",
  "IDOL_UNAVAILABLE",
  "GIFT_UNAVAILABLE",
  "VARIANT_UNAVAILABLE",
  "RECIPIENT_INELIGIBLE",
  "PRICE_UNAVAILABLE",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "QUANTITY_EXCEEDED",
  "AMOUNT_OVERFLOW",
  "IDEMPOTENCY_CONFLICT",
  "IN_PROGRESS",
  "TEMPORARY_UNAVAILABLE",
  "TRANSACTION_OUTCOME_UNKNOWN",
]);
export const cartRuntimeFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: cartRuntimeFailureCodeSchema,
});

export const cartRuntimeAccessSchema = z.strictObject({
  schemaVersion: version,
  tokenDigest: sourceHashSchema,
  pepperVersion: portKeyVersionSchema,
});
export const cartRuntimeAccessesSchema = z
  .array(cartRuntimeAccessSchema)
  .min(1)
  .max(4)
  .refine(
    (values) =>
      new Set(values.map((value) => value.pepperVersion)).size ===
      values.length,
    "Access pepper versions must be unique; the active version is first",
  );
export const cartRuntimeHeaderSchema = z.strictObject({
  schemaVersion: version,
  id: cartIdSchema,
  version: positiveVersion,
  status: z.enum(["ACTIVE", "LOCKED", "CONVERTED", "EXPIRED"]),
  expired: z.boolean(),
  presentationLocale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
  expiresAt: contentTimestampSchema,
  createdAt: contentTimestampSchema,
  updatedAt: contentTimestampSchema,
});
const privacyFlags = z.discriminatedUnion("displayMode", [
  z.strictObject({
    displayMode: z.literal("anonymous"),
    nicknameProvided: z.literal(false),
  }),
  z.strictObject({
    displayMode: z.literal("nickname"),
    nicknameProvided: z.literal(true),
  }),
]);
const flagsAgree = (value: {
  displayMode: "anonymous" | "nickname";
  nicknameProvided: boolean;
}) =>
  privacyFlags.safeParse({
    displayMode: value.displayMode,
    nicknameProvided: value.nicknameProvided,
  }).success;
const itemFields = {
  schemaVersion: version,
  id: cartItemIdSchema,
  version: positiveVersion,
  quantity: cartRuntimeQuantitySchema,
  displayMode: displayModeSchema,
  nicknameProvided: z.boolean(),
  hasFanMessage: z.boolean(),
} as const;
export const cartRuntimeItemRecordSchema = z
  .strictObject({
    ...itemFields,
    cartId: cartIdSchema,
    giftId: giftIdSchema,
    giftVariantId: giftVariantIdSchema,
    idolId: idolIdSchema,
    observedPriceId: priceIdSchema,
  })
  .refine(flagsAgree, "Display mode and nickname projection must agree");

export const cartRuntimePrivateContentSchema = z.strictObject({
  fanMessageCiphertext: encryptedValueSchema.nullable(),
  displayNameCiphertext: encryptedValueSchema.nullable(),
  encryptedDataKey: encryptedValueSchema,
  encryptionKeyVersion: keyVersionSchema,
});
export const cartRuntimeInitializeRecordCommandSchema = z.strictObject({
  schemaVersion: version,
  accesses: cartRuntimeAccessesSchema,
  cartId: cartIdSchema,
  presentationLocale: supportedLocaleSchema,
  market: marketSchema,
  currency: currencySchema,
  expiresAt: contentTimestampSchema,
});
export const cartRuntimeCredentialCommandSchema = z.strictObject({
  schemaVersion: version,
  accesses: cartRuntimeAccessesSchema,
});
export const cartRuntimeListItemsCommandSchema = z.strictObject({
  schemaVersion: version,
  cartId: cartIdSchema,
});
export const cartRuntimeResolveGiftCommandSchema = z.strictObject({
  schemaVersion: version,
  giftId: giftIdSchema,
  giftVariantId: giftVariantIdSchema,
});
export const cartRuntimeResolvedGiftSchema = z.strictObject({
  schemaVersion: version,
  giftId: giftIdSchema,
  handle: slugSchema,
});
export const cartRuntimeAppendItemCommandSchema = z
  .strictObject({
    schemaVersion: version,
    accesses: cartRuntimeAccessesSchema,
    cartId: cartIdSchema,
    expectedCartVersion: positiveVersion,
    cartItemId: cartItemIdSchema,
    supportIntentId: supportIntentIdSchema,
    giftVariantId: giftVariantIdSchema,
    idolId: idolIdSchema,
    quantity: cartRuntimeQuantitySchema,
    observedPriceId: priceIdSchema,
    createdPresentationLocale: supportedLocaleSchema,
    fanMessageLocale: fanMessageLocaleSchema,
    displayMode: displayModeSchema,
    privateContent: cartRuntimePrivateContentSchema,
    requestId: z.uuid(),
    correlationId: z.uuid(),
  })
  .refine(
    (value) =>
      (value.displayMode === "nickname") ===
      (value.privateContent.displayNameCiphertext !== null),
    "Stored display mode must match its encrypted field",
  );
export const cartRuntimeFindReceiptCommandSchema = z.strictObject({
  schemaVersion: version,
  cartId: cartIdSchema,
  cartItemId: cartItemIdSchema,
});
export const cartRuntimeReceiptSchema = z.strictObject({
  schemaVersion: version,
  cartId: cartIdSchema,
  cartItemId: cartItemIdSchema,
  supportIntentId: supportIntentIdSchema,
  cartVersion: positiveVersion,
  itemVersion: positiveVersion,
  occurredAt: contentTimestampSchema,
});

const idolView = z.strictObject({
  handle: slugSchema,
  displayName: z.string().min(1).max(80),
  portrait: publishedMediaViewSchema,
  localeContext: contentLocaleContextSchema,
});
const giftView = z.strictObject({
  handle: slugSchema,
  title: z.string().min(1).max(160),
  variantLabel: z.string().min(1).max(80),
  primaryMedia: publishedMediaViewSchema,
  localeContext: contentLocaleContextSchema,
});
const currentPrice = z.strictObject({
  priceId: priceIdSchema,
  unitAmountMinor: minorAmountSchema,
  lineTotalMinor: minorAmountSchema,
});
const priceView = z
  .strictObject({
    status: z.enum(["CURRENT", "CHANGED", "UNAVAILABLE"]),
    observedPriceId: priceIdSchema,
    current: currentPrice.nullable(),
  })
  .refine(
    (value) =>
      value.status === "UNAVAILABLE"
        ? value.current === null
        : value.current !== null &&
          (value.status === "CURRENT") ===
            (value.current.priceId.toLowerCase() ===
              value.observedPriceId.toLowerCase()),
    "Price state must agree with the current authoritative price identity",
  );
export const cartRuntimeAvailabilityReasonSchema = z.enum([
  "CONTENT_UNAVAILABLE",
  "IDOL_UNAVAILABLE",
  "GIFT_UNAVAILABLE",
  "VARIANT_UNAVAILABLE",
  "RECIPIENT_INELIGIBLE",
  "PRICE_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "QUANTITY_EXCEEDED",
  "AMOUNT_OVERFLOW",
]);
const availability = z
  .strictObject({
    status: z.enum(["AVAILABLE", "PREORDER", "UNAVAILABLE"]),
    reason: cartRuntimeAvailabilityReasonSchema.nullable(),
    maxQuantity: z
      .number()
      .int()
      .min(0)
      .max(CART_RUNTIME_MAX_QUANTITY)
      .nullable()
      .describe(
        "Null means no finite inventory limit; the command PostgreSQL integer bound still applies, and this is not unlimited stock",
      ),
  })
  .refine(
    (value) => (value.status === "UNAVAILABLE") === (value.reason !== null),
    "Availability and its reason must agree",
  );
export const cartRuntimeItemViewSchema = z
  .strictObject({
    ...itemFields,
    idol: idolView.nullable(),
    gift: giftView.nullable(),
    price: priceView,
    availability,
  })
  .superRefine((value, ctx) => {
    if (!flagsAgree(value))
      ctx.addIssue({ code: "custom", message: "Display flags disagree" });
    if (
      value.price.current &&
      BigInt(value.price.current.unitAmountMinor) * BigInt(value.quantity) !==
        BigInt(value.price.current.lineTotalMinor)
    )
      ctx.addIssue({
        code: "custom",
        path: ["price", "current", "lineTotalMinor"],
        message: "Line amount must equal unit amount times quantity",
      });
    if (
      value.availability.status !== "UNAVAILABLE" &&
      (!value.idol ||
        !value.gift ||
        !value.price.current ||
        (value.availability.maxQuantity !== null &&
          value.quantity > value.availability.maxQuantity))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Available items require current content, price and sufficient quantity",
      });
  });
export const cartRuntimeViewSchema = z
  .strictObject({
    schemaVersion: version,
    kind: z.literal("CART_RUNTIME"),
    version: positiveVersion,
    status: cartRuntimeHeaderSchema.shape.status,
    presentationLocale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    expiresAt: contentTimestampSchema,
    items: z.array(cartRuntimeItemViewSchema),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.items.map((item) => item.id.toLowerCase())).size !==
      value.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Cart item identities must be unique",
      });
    for (const [index, item] of value.items.entries()) {
      const contexts = [
        item.idol?.localeContext,
        item.idol?.portrait.schemaVersion === 2
          ? item.idol.portrait.localeContext
          : undefined,
        item.gift?.localeContext,
        item.gift?.primaryMedia.schemaVersion === 2
          ? item.gift.primaryMedia.localeContext
          : undefined,
      ];
      if (
        contexts.some(
          (context) =>
            context && context.requestedLocale !== value.presentationLocale,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["items", index],
          message:
            "Every content and media locale must match this presentation request",
        });
    }
  });
export const cartRuntimeResponseSchema = z.union([
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    action: z.enum(["INITIALIZED", "READ"]),
    cart: cartRuntimeViewSchema,
  }),
  z
    .strictObject({
      schemaVersion: version,
      outcome: z.literal("SUCCESS"),
      action: z.enum(["ADDED", "REPLAYED"]),
      cartItemId: cartItemIdSchema,
      cart: cartRuntimeViewSchema,
    })
    .refine(
      (value) =>
        value.cart.items.some(
          (item) => item.id.toLowerCase() === value.cartItemId.toLowerCase(),
        ),
      "Mutation receipt must identify a returned cart item",
    ),
  cartRuntimeFailureSchema,
]);
export const cartRuntimeAddDecisionInputSchema = z.strictObject({
  schemaVersion: version,
  cart: cartRuntimeHeaderSchema,
  command: cartRuntimeAddCommandSchema,
  current: storefrontGiftResponseSchema,
});
export const cartRuntimeAddDecisionSchema = z.union([
  cartRuntimeFailureSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    priceId: priceIdSchema,
    unitAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
  }),
]);
export const cartRuntimeProjectionInputSchema = z.strictObject({
  schemaVersion: version,
  cart: cartRuntimeHeaderSchema,
  presentationLocale: supportedLocaleSchema,
  items: z.array(
    z.strictObject({
      item: cartRuntimeItemRecordSchema,
      current: storefrontGiftResponseSchema,
    }),
  ),
});

export type CartRuntimeInitializeCommand = z.infer<
  typeof cartRuntimeInitializeCommandSchema
>;
export type CartRuntimeReadCommand = z.infer<
  typeof cartRuntimeReadCommandSchema
>;
export type CartRuntimeAddCommand = z.infer<typeof cartRuntimeAddCommandSchema>;
export type CartRuntimeCommand = z.infer<typeof cartRuntimeCommandSchema>;
export type CartRuntimeFailureCode = z.infer<
  typeof cartRuntimeFailureCodeSchema
>;
export type CartRuntimeFailure = z.infer<typeof cartRuntimeFailureSchema>;
export type CartRuntimeAccess = z.infer<typeof cartRuntimeAccessSchema>;
export type CartRuntimeAccesses = z.infer<typeof cartRuntimeAccessesSchema>;
export type CartRuntimeHeader = z.infer<typeof cartRuntimeHeaderSchema>;
export type CartRuntimeItemRecord = z.infer<typeof cartRuntimeItemRecordSchema>;
export type CartRuntimePrivateContent = z.infer<
  typeof cartRuntimePrivateContentSchema
>;
export type CartRuntimeInitializeRecordCommand = z.infer<
  typeof cartRuntimeInitializeRecordCommandSchema
>;
export type CartRuntimeCredentialCommand = z.infer<
  typeof cartRuntimeCredentialCommandSchema
>;
export type CartRuntimeListItemsCommand = z.infer<
  typeof cartRuntimeListItemsCommandSchema
>;
export type CartRuntimeResolveGiftCommand = z.infer<
  typeof cartRuntimeResolveGiftCommandSchema
>;
export type CartRuntimeResolvedGift = z.infer<
  typeof cartRuntimeResolvedGiftSchema
>;
export type CartRuntimeAppendItemCommand = z.infer<
  typeof cartRuntimeAppendItemCommandSchema
>;
export type CartRuntimeFindReceiptCommand = z.infer<
  typeof cartRuntimeFindReceiptCommandSchema
>;
export type CartRuntimeReceipt = z.infer<typeof cartRuntimeReceiptSchema>;
export type CartRuntimeItemView = z.infer<typeof cartRuntimeItemViewSchema>;
export type CartRuntimeView = z.infer<typeof cartRuntimeViewSchema>;
export type CartRuntimeResponse = z.infer<typeof cartRuntimeResponseSchema>;
export type CartRuntimeAddDecisionInput = z.infer<
  typeof cartRuntimeAddDecisionInputSchema
>;
export type CartRuntimeAddDecision = z.infer<
  typeof cartRuntimeAddDecisionSchema
>;
export type CartRuntimeProjectionInput = z.infer<
  typeof cartRuntimeProjectionInputSchema
>;
