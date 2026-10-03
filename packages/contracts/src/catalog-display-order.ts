import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { publicMediaViewSchema } from "./presentation.js";

// L2-10: operator-chosen storefront order for artists and gifts (docs/plan/2026-09-29-l2-10-display-order.md).
// Layout metadata only: no content, price, stock or recipient rule is part of an order.

export const DISPLAY_ORDER_LIMIT = 500;
export const catalogDisplayOrderKindSchema = z.enum(["IDOL", "GIFT"]);
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const catalogDisplayOrderIdsSchema = z
  .array(z.uuid())
  .max(DISPLAY_ORDER_LIMIT)
  .refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    {
      message: "Each item may appear once",
    },
  );
export const catalogDisplayOrderCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("READ"),
    kind: catalogDisplayOrderKindSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("SAVE"),
    kind: catalogDisplayOrderKindSchema,
    expectedVersion: version,
    /** Manual positions first; items left out follow in the storefront's default order. Empty restores the default. */
    orderedIds: catalogDisplayOrderIdsSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
]);
export const catalogDisplayOrderRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: catalogDisplayOrderCommandSchema,
});
export const catalogDisplayOrderItemSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  image: publicMediaViewSchema.nullable(),
  status: z.enum(["active", "paused"]),
  manual: z.boolean(),
});
export const catalogDisplayOrderResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("DISPLAY_ORDER"),
      orderKind: catalogDisplayOrderKindSchema,
      version,
      /** Items visible on the storefront, in the order the storefront shows them. */
      items: z.array(catalogDisplayOrderItemSchema).max(DISPLAY_ORDER_LIMIT),
      replayed: z.boolean(),
    })
    .refine(
      (value) =>
        new Set(value.items.map((item) => item.id)).size === value.items.length,
    ),
  adminContentFailureSchema,
]);
export type CatalogDisplayOrderKind = z.infer<
  typeof catalogDisplayOrderKindSchema
>;
export type CatalogDisplayOrderCommand = z.infer<
  typeof catalogDisplayOrderCommandSchema
>;
export type CatalogDisplayOrderRequest = z.infer<
  typeof catalogDisplayOrderRequestSchema
>;
export type CatalogDisplayOrderItem = z.infer<
  typeof catalogDisplayOrderItemSchema
>;
export type CatalogDisplayOrderResponse = z.infer<
  typeof catalogDisplayOrderResponseSchema
>;
