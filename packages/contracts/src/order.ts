import { z } from "zod";

import {
  currencySchema,
  minorAmountSchema,
  orderAmountSnapshotSchema,
} from "./commerce.js";
import {
  giftIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  orderIdSchema,
  policyRevisionIdSchema,
  policyTranslationRevisionIdSchema,
  priceIdSchema,
  publicOrderIdSchema,
  supportIntentIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  supportedLocaleSchema,
} from "./locale.js";
import { orderPaymentStatusSchema } from "./payment.js";
import { publicMediaViewSchema, slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

const timestampSchema = z.iso.datetime({ offset: true });
const positiveVersionSchema = z.number().int().positive();

export type TranslationSnapshotRef = Readonly<{
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  translationRevisionId: string;
  fallbackUsed: boolean;
}>;

const translationSnapshotBaseShape = {
  translationRevisionId: translationRevisionIdSchema,
} as const;
const directTranslationSnapshots = SUPPORTED_LOCALES.map((locale) =>
  z.strictObject({
    ...translationSnapshotBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(locale),
    fallbackUsed: z.literal(false),
  }),
);
const fallbackTranslationSnapshots = SUPPORTED_LOCALES.filter(
  (locale) => locale !== DEFAULT_LOCALE,
).map((locale) =>
  z.strictObject({
    ...translationSnapshotBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(DEFAULT_LOCALE),
    fallbackUsed: z.literal(true),
  }),
);
const translationSnapshotVariants = [
  ...directTranslationSnapshots,
  ...fallbackTranslationSnapshots,
] as unknown as readonly [
  z.ZodType<TranslationSnapshotRef>,
  z.ZodType<TranslationSnapshotRef>,
  ...z.ZodType<TranslationSnapshotRef>[],
];

export const translationSnapshotRefSchema = z.union(
  translationSnapshotVariants,
);

export const mediaSnapshotSchema = z.strictObject({
  assetId: mediaAssetIdSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  objectKey: z
    .string()
    .min(1)
    .max(1_024)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u),
  metadataRevisionId: mediaMetadataRevisionIdSchema,
  alt: z.string().min(1).max(300),
  altTranslation: translationSnapshotRefSchema,
});

export type MediaSnapshot = z.infer<typeof mediaSnapshotSchema>;

export const internalOrderItemSnapshotSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    idolTranslation: translationSnapshotRefSchema,
    giftTranslation: translationSnapshotRefSchema,
    idolId: idolIdSchema,
    idolHandle: slugSchema,
    idolDisplayName: z.string().min(1).max(40),
    idolPortrait: mediaSnapshotSchema,
    giftId: giftIdSchema,
    giftVariantId: giftVariantIdSchema,
    giftTitle: z.string().min(1).max(160),
    giftImage: mediaSnapshotSchema,
    priceId: priceIdSchema,
    priceRevision: positiveVersionSchema,
    quantity: z.number().int().positive(),
    unitAmountMinor: minorAmountSchema,
    lineSubtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
    currency: currencySchema,
    supportIntentId: supportIntentIdSchema,
    displayMode: z.enum(["anonymous", "nickname"]),
  })
  .superRefine((line, refinement) => {
    const subtotal = BigInt(line.unitAmountMinor) * BigInt(line.quantity);
    const total =
      BigInt(line.lineSubtotalMinor) +
      BigInt(line.taxAmountMinor) -
      BigInt(line.discountAmountMinor);
    if (
      subtotal !== BigInt(line.lineSubtotalMinor) ||
      total !== BigInt(line.lineTotalMinor)
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["lineTotalMinor"],
        message: "order item amount snapshot is inconsistent",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "lineSubtotalMinor = unitAmountMinor * quantity",
      "lineTotalMinor = lineSubtotalMinor + taxAmountMinor - discountAmountMinor",
    ],
  });

export type InternalOrderItemSnapshot = z.infer<
  typeof internalOrderItemSnapshotSchema
>;

export const publicOrderItemViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    idol: z.strictObject({
      handle: slugSchema,
      displayName: z.string().min(1).max(40),
      portrait: publicMediaViewSchema,
    }),
    gift: z.strictObject({
      title: z.string().min(1).max(160),
      image: publicMediaViewSchema,
    }),
    quantity: z.number().int().positive(),
    unitAmountMinor: minorAmountSchema,
    lineSubtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
    currency: currencySchema,
    displayMode: z.enum(["anonymous", "nickname"]),
  })
  .superRefine((line, refinement) => {
    const subtotal = BigInt(line.unitAmountMinor) * BigInt(line.quantity);
    const total =
      BigInt(line.lineSubtotalMinor) +
      BigInt(line.taxAmountMinor) -
      BigInt(line.discountAmountMinor);
    if (
      subtotal !== BigInt(line.lineSubtotalMinor) ||
      total !== BigInt(line.lineTotalMinor)
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["lineTotalMinor"],
        message: "public order item amount snapshot is inconsistent",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "lineSubtotalMinor = unitAmountMinor * quantity",
      "lineTotalMinor = lineSubtotalMinor + taxAmountMinor - discountAmountMinor",
    ],
  });

export type PublicOrderItemView = z.infer<typeof publicOrderItemViewSchema>;

export function toPublicOrderItemView(
  value: unknown,
  mediaUrls: Readonly<{
    idolPortraitUrl: string;
    giftImageUrl: string;
  }>,
): PublicOrderItemView {
  const item = internalOrderItemSnapshotSchema.parse(value);
  return publicOrderItemViewSchema.parse({
    schemaVersion: 1,
    idol: {
      handle: item.idolHandle,
      displayName: item.idolDisplayName,
      portrait: {
        url: mediaUrls.idolPortraitUrl,
        alt: item.idolPortrait.alt,
      },
    },
    gift: {
      title: item.giftTitle,
      image: {
        url: mediaUrls.giftImageUrl,
        alt: item.giftImage.alt,
      },
    },
    quantity: item.quantity,
    unitAmountMinor: item.unitAmountMinor,
    lineSubtotalMinor: item.lineSubtotalMinor,
    taxAmountMinor: item.taxAmountMinor,
    discountAmountMinor: item.discountAmountMinor,
    lineTotalMinor: item.lineTotalMinor,
    currency: item.currency,
    displayMode: item.displayMode,
  });
}

export const policyAcceptanceSnapshotSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  locale: supportedLocaleSchema,
  policyRevisionId: policyRevisionIdSchema,
  policyTranslationRevisionId: policyTranslationRevisionIdSchema,
  acceptedAt: timestampSchema,
});

export type PolicyAcceptanceSnapshot = z.infer<
  typeof policyAcceptanceSnapshotSchema
>;

export const orderStatusSchema = z.enum([
  "DRAFT",
  "PENDING_PAYMENT",
  "OPEN",
  "CLOSED",
  "CANCELED",
]);
export const disputeStatusSchema = z.enum(["NONE", "OPEN", "WON", "LOST"]);
export const fulfillmentStatusSchema = z.enum([
  "PENDING",
  "PREPARING",
  "DELIVERED",
  "ON_HOLD",
  "CANCELED",
]);

type AggregateAmount = Readonly<{
  currency: string;
  subtotalMinor: number;
  taxAmountMinor: number;
  shippingAmountMinor: number;
  feeAmountMinor: number;
  discountAmountMinor: number;
  totalAmountMinor: number;
}>;

type AggregateLine = Readonly<{
  currency: string;
  lineSubtotalMinor: number;
  taxAmountMinor: number;
  discountAmountMinor: number;
  lineTotalMinor: number;
}>;

function hasMatchingOrderAggregate(
  amount: AggregateAmount,
  items: readonly AggregateLine[],
): boolean {
  const subtotal = items.reduce(
    (sum, item) => sum + BigInt(item.lineSubtotalMinor),
    0n,
  );
  const tax = items.reduce(
    (sum, item) => sum + BigInt(item.taxAmountMinor),
    0n,
  );
  const discount = items.reduce(
    (sum, item) => sum + BigInt(item.discountAmountMinor),
    0n,
  );
  const lineTotal = items.reduce(
    (sum, item) => sum + BigInt(item.lineTotalMinor),
    0n,
  );

  return (
    items.every((item) => item.currency === amount.currency) &&
    subtotal === BigInt(amount.subtotalMinor) &&
    tax === BigInt(amount.taxAmountMinor) &&
    discount === BigInt(amount.discountAmountMinor) &&
    lineTotal +
      BigInt(amount.shippingAmountMinor) +
      BigInt(amount.feeAmountMinor) ===
      BigInt(amount.totalAmountMinor)
  );
}

function addOrderAggregateIssue(
  amount: AggregateAmount,
  items: readonly AggregateLine[],
  refinement: z.RefinementCtx,
): void {
  if (!hasMatchingOrderAggregate(amount, items)) {
    refinement.addIssue({
      code: "custom",
      path: ["amount"],
      message: "order items, currency, and amount snapshot must agree",
    });
  }
}

const orderAggregateMetadata = {
  "x-runtime-invariants": [
    "all item currencies equal the order currency",
    "item subtotal, tax, discount, and line totals equal the order amount snapshot",
  ],
} as const;

export const orderSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: orderIdSchema,
    publicOrderId: publicOrderIdSchema,
    presentationLocale: supportedLocaleSchema,
    orderStatus: orderStatusSchema,
    paymentStatus: orderPaymentStatusSchema,
    disputeStatus: disputeStatusSchema,
    fulfillmentStatus: fulfillmentStatusSchema,
    amount: orderAmountSnapshotSchema,
    items: z.array(internalOrderItemSnapshotSchema).min(1),
    policyAcceptances: z.array(policyAcceptanceSnapshotSchema).min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((order, refinement) => {
    addOrderAggregateIssue(order.amount, order.items, refinement);
  })
  .meta(orderAggregateMetadata);

export type Order = z.infer<typeof orderSchema>;

export const publicOrderAmountViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    currency: currencySchema,
    subtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    shippingAmountMinor: minorAmountSchema,
    feeAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    totalAmountMinor: minorAmountSchema,
  })
  .superRefine((amount, refinement) => {
    const total =
      BigInt(amount.subtotalMinor) +
      BigInt(amount.taxAmountMinor) +
      BigInt(amount.shippingAmountMinor) +
      BigInt(amount.feeAmountMinor) -
      BigInt(amount.discountAmountMinor);
    if (total !== BigInt(amount.totalAmountMinor)) {
      refinement.addIssue({
        code: "custom",
        path: ["totalAmountMinor"],
        message: "public order amount is inconsistent",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "totalAmountMinor = subtotalMinor + taxAmountMinor + shippingAmountMinor + feeAmountMinor - discountAmountMinor",
    ],
  });

export const publicOrderViewSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    publicOrderId: publicOrderIdSchema,
    presentationLocale: supportedLocaleSchema,
    orderStatus: orderStatusSchema,
    paymentStatus: orderPaymentStatusSchema,
    disputeStatus: disputeStatusSchema,
    fulfillmentStatus: fulfillmentStatusSchema,
    amount: publicOrderAmountViewSchema,
    items: z.array(publicOrderItemViewSchema).min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((order, refinement) => {
    addOrderAggregateIssue(order.amount, order.items, refinement);
  })
  .meta(orderAggregateMetadata);

export type PublicOrderView = z.infer<typeof publicOrderViewSchema>;
