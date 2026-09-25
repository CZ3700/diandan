import { z } from "zod";
import {
  cartIdSchema,
  cartItemIdSchema,
  eventIdSchema,
} from "./identifiers.js";
import { contentTimestampSchema } from "./content-lifecycle.js";

/** A separate event namespace preserves the historical DomainEvent v1 roots. */
export const cartEditEventSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    eventId: eventIdSchema,
    eventType: z.enum(["CART_ITEM_UPDATED", "CART_ITEM_REMOVED"]),
    aggregateId: cartIdSchema,
    occurredAt: contentTimestampSchema,
    requestId: z.uuid(),
    correlationId: z.uuid(),
    payload: z.strictObject({
      cartId: cartIdSchema,
      cartItemId: cartItemIdSchema,
      receiptId: z.uuid(),
    }),
  })
  .refine(
    (value) =>
      value.aggregateId.toLowerCase() === value.payload.cartId.toLowerCase(),
    "Cart event ownership must match",
  );
export type CartEditEvent = z.infer<typeof cartEditEventSchema>;
