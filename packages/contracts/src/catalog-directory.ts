import { z } from "zod";
import {
  CATALOG_DISCOVERY_LIMITS,
  catalogPageInfoSchema,
  giftDiscoveryPlanSchema,
  idolDiscoveryPlanSchema,
  idolDiscoveryQuerySchema,
} from "./catalog-discovery.js";
import {
  publishedGiftViewSchema,
  publishedIdolViewSchema,
} from "./catalog-content.js";
import { currencySchema, marketSchema } from "./commerce.js";
import { minorAmountSchema } from "./commerce.js";
import { idolIdSchema } from "./identifiers.js";
import {
  giftPublicProjectionSourceSchema,
  idolPublicProjectionSourceSchema,
} from "./public-projection.js";
import { publicRevisionSelectionSchema } from "./publication.js";
import { schemaVersionSchema } from "./versioning.js";

export const catalogVersionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const idolDirectoryCursorSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    queryHash: catalogVersionSchema,
    catalogVersion: catalogVersionSchema,
    afterId: idolIdSchema,
  })
  .meta({
    "x-runtime-invariants": [
      "Public navigation state only; never an authorization credential",
      "Strict canonical base64url encoding; bound to locale, normalized search and limit",
      "Server snapshot version mismatch requires restarting the directory query",
    ],
  });
export const idolDirectoryReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  plan: idolDiscoveryPlanSchema,
  continuation: idolDirectoryCursorSchema.optional(),
});
export const giftDirectoryReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  plan: giftDiscoveryPlanSchema,
});
export const idolDirectoryRecordSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    selection: publicRevisionSelectionSchema,
    source: idolPublicProjectionSourceSchema,
  })
  .refine((value) => value.selection.objectKind === "IDOL");
export const giftDirectoryRecordSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    selection: publicRevisionSelectionSchema,
    source: giftPublicProjectionSourceSchema,
  })
  .refine((value) => value.selection.objectKind === "GIFT");
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
export const idolDirectorySnapshotSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    catalogVersion: catalogVersionSchema,
    items: z
      .array(idolDirectoryRecordSchema)
      .max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum),
    hasNextPage: z.boolean(),
  }),
  catalogDirectoryFailureSchema,
]);
export const giftDirectorySnapshotSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    catalogVersion: catalogVersionSchema,
    items: z
      .array(
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          record: giftDirectoryRecordSchema,
          offer: catalogDirectoryOfferSchema,
        }),
      )
      .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
    totalItems: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  catalogDirectoryFailureSchema,
]);
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

export type IdolDirectoryCursor = z.infer<typeof idolDirectoryCursorSchema>;
export type IdolDirectoryReadCommand = z.infer<
  typeof idolDirectoryReadCommandSchema
>;
export type GiftDirectoryReadCommand = z.infer<
  typeof giftDirectoryReadCommandSchema
>;
export type IdolDirectoryRecord = z.infer<typeof idolDirectoryRecordSchema>;
export type GiftDirectoryRecord = z.infer<typeof giftDirectoryRecordSchema>;
export type CatalogDirectoryOffer = z.infer<typeof catalogDirectoryOfferSchema>;
export type CatalogDirectoryFailure = z.infer<
  typeof catalogDirectoryFailureSchema
>;
export type IdolDirectorySnapshot = z.infer<typeof idolDirectorySnapshotSchema>;
export type GiftDirectorySnapshot = z.infer<typeof giftDirectorySnapshotSchema>;
export type IdolDirectoryResponse = z.infer<typeof idolDirectoryResponseSchema>;
export type GiftDirectoryResponse = z.infer<typeof giftDirectoryResponseSchema>;

export const idolDirectoryCursorEncodingInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  query: idolDiscoveryQuerySchema,
  catalogVersion: catalogVersionSchema,
  afterId: idolIdSchema,
});
export const idolDirectoryCursorDecodingInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  query: idolDiscoveryQuerySchema,
  cursor: idolDiscoveryQuerySchema.shape.after.unwrap(),
});
