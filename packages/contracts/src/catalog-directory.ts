import { z } from "zod";
import { dailyPublicationContextSchema } from "./daily-publication.js";
import {
  catalogVersionSchema,
  catalogDirectoryOfferSchema,
  catalogDirectoryFailureSchema,
} from "./catalog-directory-public.js";
export {
  catalogVersionSchema,
  catalogDirectoryOfferSchema,
  catalogDirectoryFailureSchema,
  idolDirectoryResponseSchema,
  giftDirectoryResponseSchema,
  type CatalogDirectoryOffer,
  type CatalogDirectoryFailure,
  type IdolDirectoryResponse,
  type GiftDirectoryResponse,
} from "./catalog-directory-public.js";
import {
  CATALOG_DISCOVERY_LIMITS,
  giftDiscoveryPlanSchema,
  idolDiscoveryPlanSchema,
  idolDiscoveryQuerySchema,
} from "./catalog-discovery.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { idolIdSchema } from "./identifiers.js";
import {
  giftPublicProjectionSourceSchema,
  idolPublicProjectionSourceSchema,
} from "./public-projection.js";
import { publicRevisionSelectionSchema } from "./publication.js";
import { schemaVersionSchema } from "./versioning.js";

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
export const legacyIdolDirectoryRecordSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    selection: publicRevisionSelectionSchema,
    source: idolPublicProjectionSourceSchema,
  })
  .refine((value) => value.selection.objectKind === "IDOL");
export const legacyGiftDirectoryRecordSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    selection: publicRevisionSelectionSchema,
    source: giftPublicProjectionSourceSchema,
  })
  .refine((value) => value.selection.objectKind === "GIFT");
export const idolDirectoryRecordSchema = z.union([
  legacyIdolDirectoryRecordSchema,
  z
    .strictObject({
      schemaVersion: z.literal(3),
      context: dailyPublicationContextSchema,
    })
    .refine((value) => value.context.current.document.kind === "IDOL"),
]);
export const giftDirectoryRecordSchema = z.union([
  legacyGiftDirectoryRecordSchema,
  z
    .strictObject({
      schemaVersion: z.literal(3),
      context: dailyPublicationContextSchema,
    })
    .refine((value) => value.context.current.document.kind === "GIFT"),
]);
function idolSnapshot<R extends z.ZodType>(record: R) {
  return z.union([
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("SUCCESS"),
      catalogVersion: catalogVersionSchema,
      items: z.array(record).max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum),
      hasNextPage: z.boolean(),
    }),
    catalogDirectoryFailureSchema,
  ]);
}
function giftSnapshot<R extends z.ZodType>(record: R) {
  return z.union([
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("SUCCESS"),
      catalogVersion: catalogVersionSchema,
      items: z
        .array(
          z.strictObject({
            schemaVersion: schemaVersionSchema,
            record,
            offer: catalogDirectoryOfferSchema,
            /** The published classification; null is an unclassified legacy revision. */
            giftKind: giftKindSchema.nullable().optional(),
          }),
        )
        .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
      totalItems: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
    catalogDirectoryFailureSchema,
  ]);
}
export const legacyIdolDirectorySnapshotSchema = idolSnapshot(
  legacyIdolDirectoryRecordSchema,
);
export const legacyGiftDirectorySnapshotSchema = giftSnapshot(
  legacyGiftDirectoryRecordSchema,
);
export const idolDirectorySnapshotSchema = idolSnapshot(
  idolDirectoryRecordSchema,
);
export const giftDirectorySnapshotSchema = giftSnapshot(
  giftDirectoryRecordSchema,
);
export type LegacyIdolDirectoryRecord = z.infer<
  typeof legacyIdolDirectoryRecordSchema
>;
export type LegacyGiftDirectoryRecord = z.infer<
  typeof legacyGiftDirectoryRecordSchema
>;

export type IdolDirectoryCursor = z.infer<typeof idolDirectoryCursorSchema>;
export type IdolDirectoryReadCommand = z.infer<
  typeof idolDirectoryReadCommandSchema
>;
export type GiftDirectoryReadCommand = z.infer<
  typeof giftDirectoryReadCommandSchema
>;
export type IdolDirectoryRecord = z.infer<typeof idolDirectoryRecordSchema>;
export type GiftDirectoryRecord = z.infer<typeof giftDirectoryRecordSchema>;
export type IdolDirectorySnapshot = z.infer<typeof idolDirectorySnapshotSchema>;
export type GiftDirectorySnapshot = z.infer<typeof giftDirectorySnapshotSchema>;

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
