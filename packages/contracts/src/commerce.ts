import { z } from "zod";

import {
  adminIdentityIdSchema,
  cartIdSchema,
  cartItemIdSchema,
  checkoutQuoteIdSchema,
  checkoutSessionIdSchema,
  giftIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  moderationEvidenceIdSchema,
  priceIdSchema,
  supportIntentIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publicMediaViewSchema, slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const displayModeSchema = z.enum(["anonymous", "nickname"]);
export const fanMessageLocaleSchema = z.union([
  supportedLocaleSchema,
  z.literal("und"),
]);

const cartGiftContextBaseShape = {
  schemaVersion: schemaVersionSchema,
  idolId: idolIdSchema,
  giftId: giftIdSchema,
  giftVariantId: giftVariantIdSchema,
  fanMessage: z.string().min(1).max(280).optional(),
  presentationLocale: supportedLocaleSchema,
  fanMessageLocale: fanMessageLocaleSchema,
} as const;

export const cartGiftContextSchema = z.union([
  z.strictObject({
    ...cartGiftContextBaseShape,
    displayMode: z.literal("anonymous"),
  }),
  z.strictObject({
    ...cartGiftContextBaseShape,
    displayMode: z.literal("nickname"),
    displayName: z.string().min(1).max(40),
  }),
]);

export type CartGiftContext = z.infer<typeof cartGiftContextSchema>;

const positiveVersionSchema = z.number().int().positive();
const timestampSchema = z.iso.datetime({ offset: true });
const encryptedValueSchema = z
  .string()
  .min(39)
  .max(16_391)
  .regex(/^enc:v1:[A-Za-z0-9_-]{32,16384}$/u)
  .brand<"EncryptedValue">();
const internalCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const keyVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const moderationDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("HUMAN"),
    reviewerId: adminIdentityIdSchema,
    reviewedAt: timestampSchema,
  }),
  z.strictObject({
    kind: z.literal("AUTOMATED"),
    ruleVersion: keyVersionSchema,
    evidenceId: moderationEvidenceIdSchema,
    reviewedAt: timestampSchema,
  }),
]);

export const supportIntentModerationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("PENDING"),
  }),
  z.strictObject({
    status: z.literal("APPROVED"),
    decision: moderationDecisionSchema,
  }),
  z.strictObject({
    status: z.literal("REJECTED"),
    reasonCode: internalCodeSchema,
    decision: moderationDecisionSchema,
  }),
  z.strictObject({
    status: z.literal("REDACTED"),
    reasonCode: internalCodeSchema,
    decision: moderationDecisionSchema,
  }),
]);

export const marketSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_-]{1,15}$/u)
  .brand<"Market">();
export const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/u)
  .brand<"CountryCode">();
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/u)
  .brand<"Currency">();
export const minorAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"MinorAmount">();

export type MarketCode = z.infer<typeof marketSchema>;
export type CountryCode = z.infer<typeof countrySchema>;
export type CurrencyCode = z.infer<typeof currencySchema>;
export type MinorAmount = z.infer<typeof minorAmountSchema>;

const supportIntentBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: supportIntentIdSchema,
  cartItemId: cartItemIdSchema,
  idolId: idolIdSchema,
  fanMessageCiphertext: encryptedValueSchema.optional(),
  encryptedDataKey: encryptedValueSchema,
  encryptionKeyVersion: keyVersionSchema,
  moderation: supportIntentModerationSchema,
  createdPresentationLocale: supportedLocaleSchema,
  fanMessageLocale: fanMessageLocaleSchema,
  status: z.enum([
    "ACTIVE",
    "CHECKOUT_LOCKED",
    "CONVERTED",
    "EXPIRED",
    "CANCELED",
  ]),
  version: positiveVersionSchema,
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
} as const;

export const supportIntentSchema = z.union([
  z.strictObject({
    ...supportIntentBaseShape,
    displayMode: z.literal("anonymous"),
  }),
  z.strictObject({
    ...supportIntentBaseShape,
    displayMode: z.literal("nickname"),
    displayNameCiphertext: encryptedValueSchema,
  }),
]);

export type SupportIntent = z.infer<typeof supportIntentSchema>;

const cartItemBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: cartItemIdSchema,
  cartId: cartIdSchema,
  version: positiveVersionSchema,
  giftVariantId: giftVariantIdSchema,
  quantity: z.number().int().positive(),
  observedPriceId: priceIdSchema,
  hasFanMessage: z.boolean(),
} as const;

export const cartItemSchema = z.discriminatedUnion("displayMode", [
  z.strictObject({
    ...cartItemBaseShape,
    displayMode: z.literal("anonymous"),
    nicknameProvided: z.literal(false),
  }),
  z.strictObject({
    ...cartItemBaseShape,
    displayMode: z.literal("nickname"),
    nicknameProvided: z.literal(true),
  }),
]);

export const cartSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: cartIdSchema,
    version: positiveVersionSchema,
    status: z.enum(["ACTIVE", "LOCKED", "CONVERTED", "EXPIRED"]),
    presentationLocale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    items: z.array(cartItemSchema),
    expiresAt: timestampSchema,
  })
  .superRefine((cart, refinement) => {
    if (cart.items.some((item) => item.cartId !== cart.id)) {
      refinement.addIssue({
        code: "custom",
        path: ["items"],
        message: "all cart items must belong to the containing cart",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "all cart item cartId values equal the containing cart ID",
    ],
  });

export type Cart = z.infer<typeof cartSchema>;

const publicCartItemBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: cartItemIdSchema,
  version: positiveVersionSchema,
  quantity: z.number().int().positive(),
  idol: z.strictObject({
    handle: slugSchema,
    displayName: z.string().min(1).max(40),
  }),
  gift: z.strictObject({
    handle: slugSchema,
    title: z.string().min(1).max(160),
    variantLabel: z.string().min(1).max(80),
    image: publicMediaViewSchema,
  }),
  hasFanMessage: z.boolean(),
  unitAmountMinor: minorAmountSchema,
  lineTotalMinor: minorAmountSchema,
  currency: currencySchema,
} as const;

export const publicCartItemViewSchema = z
  .discriminatedUnion("displayMode", [
    z.strictObject({
      ...publicCartItemBaseShape,
      displayMode: z.literal("anonymous"),
      nicknameProvided: z.literal(false),
    }),
    z.strictObject({
      ...publicCartItemBaseShape,
      displayMode: z.literal("nickname"),
      nicknameProvided: z.literal(true),
    }),
  ])
  .superRefine((line, refinement) => {
    const expectedTotal = BigInt(line.unitAmountMinor) * BigInt(line.quantity);
    if (expectedTotal !== BigInt(line.lineTotalMinor)) {
      refinement.addIssue({
        code: "custom",
        path: ["lineTotalMinor"],
        message: "public cart line total must equal unit amount times quantity",
      });
    }
  })
  .meta({
    "x-runtime-invariants": ["lineTotalMinor = unitAmountMinor * quantity"],
  });

export const publicCartViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    version: positiveVersionSchema,
    status: z.enum(["ACTIVE", "LOCKED", "CONVERTED", "EXPIRED"]),
    presentationLocale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    expiresAt: timestampSchema,
    items: z.array(publicCartItemViewSchema),
  })
  .superRefine((cart, refinement) => {
    if (cart.items.some((item) => item.currency !== cart.currency)) {
      refinement.addIssue({
        code: "custom",
        path: ["items"],
        message: "all cart item currencies must equal the cart currency",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "all cart item currencies equal the cart currency",
    ],
  });

export type PublicCartView = z.infer<typeof publicCartViewSchema>;

export const orderAmountSnapshotSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    market: marketSchema,
    currency: currencySchema,
    quoteRevision: positiveVersionSchema,
    quoteExpiresAt: timestampSchema,
    subtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    shippingAmountMinor: minorAmountSchema,
    feeAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    totalAmountMinor: minorAmountSchema,
  })
  .superRefine((amount, refinement) => {
    const expectedTotal =
      BigInt(amount.subtotalMinor) +
      BigInt(amount.taxAmountMinor) +
      BigInt(amount.shippingAmountMinor) +
      BigInt(amount.feeAmountMinor) -
      BigInt(amount.discountAmountMinor);
    if (expectedTotal !== BigInt(amount.totalAmountMinor)) {
      refinement.addIssue({
        code: "custom",
        path: ["totalAmountMinor"],
        message: "totalAmountMinor must equal the persisted amount components",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "totalAmountMinor = subtotalMinor + taxAmountMinor + shippingAmountMinor + feeAmountMinor - discountAmountMinor",
    ],
  });

export type OrderAmountSnapshot = z.infer<typeof orderAmountSnapshotSchema>;

export const checkoutQuoteLineSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    cartItemId: cartItemIdSchema,
    giftVariantId: giftVariantIdSchema,
    priceId: priceIdSchema,
    priceRevision: positiveVersionSchema,
    quantity: z.number().int().positive(),
    unitAmountMinor: minorAmountSchema,
    lineSubtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
  })
  .superRefine((line, refinement) => {
    const expectedSubtotal =
      BigInt(line.unitAmountMinor) * BigInt(line.quantity);
    if (expectedSubtotal !== BigInt(line.lineSubtotalMinor)) {
      refinement.addIssue({
        code: "custom",
        path: ["lineSubtotalMinor"],
        message: "lineSubtotalMinor must equal unitAmountMinor times quantity",
      });
    }

    const expectedTotal =
      BigInt(line.lineSubtotalMinor) +
      BigInt(line.taxAmountMinor) -
      BigInt(line.discountAmountMinor);
    if (expectedTotal !== BigInt(line.lineTotalMinor)) {
      refinement.addIssue({
        code: "custom",
        path: ["lineTotalMinor"],
        message: "lineTotalMinor must equal subtotal plus tax minus discount",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "lineSubtotalMinor = unitAmountMinor * quantity",
      "lineTotalMinor = lineSubtotalMinor + taxAmountMinor - discountAmountMinor",
    ],
  });

export const checkoutQuoteSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: checkoutQuoteIdSchema,
    cartVersion: positiveVersionSchema,
    amount: orderAmountSnapshotSchema,
    lines: z.array(checkoutQuoteLineSchema).min(1),
    expiresAt: timestampSchema,
  })
  .superRefine((quote, refinement) => {
    const subtotal = quote.lines.reduce(
      (sum, line) => sum + BigInt(line.lineSubtotalMinor),
      0n,
    );
    const tax = quote.lines.reduce(
      (sum, line) => sum + BigInt(line.taxAmountMinor),
      0n,
    );
    const discount = quote.lines.reduce(
      (sum, line) => sum + BigInt(line.discountAmountMinor),
      0n,
    );
    const lineTotal = quote.lines.reduce(
      (sum, line) => sum + BigInt(line.lineTotalMinor),
      0n,
    );
    if (
      subtotal !== BigInt(quote.amount.subtotalMinor) ||
      tax !== BigInt(quote.amount.taxAmountMinor) ||
      discount !== BigInt(quote.amount.discountAmountMinor) ||
      lineTotal +
        BigInt(quote.amount.shippingAmountMinor) +
        BigInt(quote.amount.feeAmountMinor) !==
        BigInt(quote.amount.totalAmountMinor) ||
      quote.expiresAt !== quote.amount.quoteExpiresAt
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["amount"],
        message: "quote lines, amount snapshot, and expiry must agree",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "line sums must equal the amount snapshot and quote expiry",
    ],
  });

export type CheckoutQuote = z.infer<typeof checkoutQuoteSchema>;

export const checkoutSessionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: checkoutSessionIdSchema,
  status: z.enum([
    "CREATED",
    "READY",
    "PAYMENT_PENDING",
    "COMPLETED",
    "EXPIRED",
  ]),
  cartVersion: positiveVersionSchema,
  quote: checkoutQuoteSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;
