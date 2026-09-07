import { z } from "zod";
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
