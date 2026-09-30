import { idolIdSchema } from "./identifiers.js";
import { z } from "zod";
import { slugSchema } from "./presentation.js";

/** Stable purchase identity; content revisions never replace an existing binding. */
export const wishBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  wishId: z.uuid(),
  giftId: z.uuid(),
  giftVariantId: z.uuid(),
  idolId: z.uuid(),
  inventoryLocationId: z.uuid(),
});
export type WishBinding = z.infer<typeof wishBindingSchema>;

/** Dynamic safe projection, never written into immutable gift content or hashes. */
export const wishGiftSummarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  wishId: z.uuid(),
  artistId: idolIdSchema,
  artistName: z.string().min(1).max(80),
  artistHandle: slugSchema,
  status: z.enum(["AVAILABLE", "RESERVED", "SUPPORTED", "UNAVAILABLE"]),
});
export type WishGiftSummary = z.infer<typeof wishGiftSummarySchema>;
