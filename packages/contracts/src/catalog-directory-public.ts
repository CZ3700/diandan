import { z } from "zod";
import {
  CATALOG_DISCOVERY_LIMITS,
  catalogPageInfoSchema,
  idolDiscoveryQuerySchema,
} from "./catalog-discovery.js";
import {
  publishedGiftViewSchema,
  publishedIdolViewSchema,
} from "./catalog-content.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { schemaVersionSchema } from "./versioning.js";

export const catalogVersionSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const catalogDirectoryOfferSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    market: marketSchema,
    currency: currencySchema,
    priceMinor: minorAmountSchema.nullable(),
    purchasable: z.boolean(),
  })
  .refine((value) => value.purchasable === (value.priceMinor !== null), {
    message:
      "The displayed price is the minimum currently purchasable eligible variant price",
  });
export const catalogDirectoryFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_QUERY",
    "INVALID_CURSOR",
    "CATALOG_CHANGED",
    "ANCHOR_NOT_FOUND",
    "CATALOG_UNAVAILABLE",
  ]),
});
const idolPageInfoSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    hasNextPage: z.boolean(),
    endCursor: idolDiscoveryQuerySchema.shape.after.unwrap().nullable(),
  })
  .refine((value) => value.hasNextPage === (value.endCursor !== null));
export const idolDirectoryResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    catalogVersion: catalogVersionSchema,
    items: z
      .array(publishedIdolViewSchema)
      .max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum),
    pageInfo: idolPageInfoSchema,
  }),
  catalogDirectoryFailureSchema,
]);
export const giftDirectoryResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    catalogVersion: catalogVersionSchema,
    items: z
      .array(
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          gift: publishedGiftViewSchema,
          offer: catalogDirectoryOfferSchema,
        }),
      )
      .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
    pageInfo: catalogPageInfoSchema,
  }),
  catalogDirectoryFailureSchema,
]);

export type CatalogDirectoryOffer = z.infer<typeof catalogDirectoryOfferSchema>;
export type CatalogDirectoryFailure = z.infer<
  typeof catalogDirectoryFailureSchema
>;
export type IdolDirectoryResponse = z.infer<typeof idolDirectoryResponseSchema>;
export type GiftDirectoryResponse = z.infer<typeof giftDirectoryResponseSchema>;
