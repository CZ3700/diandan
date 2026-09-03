import { z } from "zod";

import {
  cartItemIdSchema,
  checkoutQuoteIdSchema,
  giftIdSchema,
  giftVariantIdSchema,
  idolIdSchema,
  inventoryLocationIdSchema,
  inventoryReservationIdSchema,
  priceBookIdSchema,
  priceIdSchema,
} from "./identifiers.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { localeContextSchema } from "./locale.js";
import { publicMediaViewSchema, slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

const timestampSchema = z.iso.datetime({ offset: true });
const positiveVersionSchema = z.number().int().positive();
// Base-row operational status from spec 9.2/9.3. Immutable revision
// publication lifecycle and public published projections are owned by P1-02.
export const catalogOperationalStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "archived",
]);

export const publicCatalogOperationalStatusSchema = z.enum([
  "active",
  "paused",
]);

export const idolSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: idolIdSchema,
  handle: slugSchema,
  status: catalogOperationalStatusSchema,
  acceptingGifts: z.boolean(),
  localeContext: localeContextSchema,
  displayName: z.string().min(1).max(40),
  shortBio: z.string().max(160).optional(),
  portrait: publicMediaViewSchema,
});

export type Idol = z.infer<typeof idolSchema>;

export const giftVariantSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftVariantIdSchema,
  label: z.string().min(1).max(80),
  status: catalogOperationalStatusSchema,
  inventoryPolicy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
});

export const giftSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: giftIdSchema,
  handle: slugSchema,
  status: catalogOperationalStatusSchema,
  localeContext: localeContextSchema,
  title: z.string().min(1).max(160),
  subtitle: z.string().max(80).optional(),
  description: z.string().min(1).max(600),
  fulfillmentDescription: z.string().min(1).max(600),
  shippingMode: z.literal("internal_to_idol"),
  variants: z.array(giftVariantSchema).min(1),
});

export type Gift = z.infer<typeof giftSchema>;

export const giftOfferSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  idolId: idolIdSchema,
  giftId: giftIdSchema,
  giftVariantId: giftVariantIdSchema,
  eligible: z.literal(true),
  priceId: priceIdSchema,
  priceRevision: positiveVersionSchema,
  market: marketSchema,
  currency: currencySchema,
  unitAmountMinor: minorAmountSchema,
  inventoryPolicy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
  availability: z.enum(["AVAILABLE", "LOW_STOCK", "PREORDER", "UNAVAILABLE"]),
});

export type GiftOffer = z.infer<typeof giftOfferSchema>;

export const priceBookSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: priceBookIdSchema,
  revision: positiveVersionSchema,
  market: marketSchema,
  currency: currencySchema,
  status: z.enum(["DRAFT", "VALIDATED", "PUBLISHED", "SUPERSEDED", "ARCHIVED"]),
  validFrom: timestampSchema,
  validUntil: timestampSchema.optional(),
});

export type PriceBook = z.infer<typeof priceBookSchema>;

export const inventoryReservationSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: inventoryReservationIdSchema,
  checkoutQuoteId: checkoutQuoteIdSchema,
  cartItemId: cartItemIdSchema,
  giftVariantId: giftVariantIdSchema,
  inventoryLocationId: inventoryLocationIdSchema,
  quantity: z.number().int().positive(),
  status: z.enum(["ACTIVE", "COMMITTED", "RELEASED", "EXPIRED"]),
  expiresAt: timestampSchema,
  version: positiveVersionSchema,
});

export type InventoryReservation = z.infer<typeof inventoryReservationSchema>;
