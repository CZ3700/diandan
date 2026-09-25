import { z } from "zod";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { inventoryReservationCreationApplySchema } from "./domain-rules.js";
import {
  cartItemIdSchema,
  checkoutQuoteIdSchema,
  inventoryItemIdSchema,
  inventoryLocationIdSchema,
  inventoryReservationIdSchema,
} from "./identifiers.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLocationSchema,
} from "./pricing-inventory-content.js";
import { inventoryReservationSchema } from "./catalog.js";
import { checkoutPreflightCurrentSchema } from "./checkout-preflight-internal.js";
import { checkoutPreflightFailureSchema } from "./checkout-preflight.js";

export const checkoutInventoryAssignmentSchema = z.strictObject({
  cartItemId: cartItemIdSchema,
  inventoryItemId: inventoryItemIdSchema,
  inventoryLocationId: inventoryLocationIdSchema,
});
const targetSchema = z.strictObject({
  inventoryItemId: inventoryItemIdSchema,
  inventoryLocationId: inventoryLocationIdSchema,
});
export const checkoutInventorySelectionSchema = z.union([
  checkoutPreflightFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    assignments: z.array(checkoutInventoryAssignmentSchema).max(500),
    targets: z.array(targetSchema).max(500),
  }),
]);
/** The application obtains these rows through stable, bounded batches in one transaction. */
export const checkoutInventoryPlanCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  current: checkoutPreflightCurrentSchema,
  assignments: z.array(checkoutInventoryAssignmentSchema).max(500),
  lockedInventory: z
    .array(
      z.strictObject({
        inventoryItem: inventoryItemSchema,
        inventoryLocation: inventoryLocationSchema,
        balance: inventoryBalanceSchema,
        reservation: inventoryReservationSchema.nullable(),
      }),
    )
    .max(500),
  reservations: z
    .array(
      z.strictObject({
        cartItemId: cartItemIdSchema,
        reservationId: inventoryReservationIdSchema,
      }),
    )
    .max(500),
  quoteId: checkoutQuoteIdSchema,
  expiresAt: contentTimestampSchema,
  evaluatedAt: contentTimestampSchema,
});
export const checkoutInventoryPlanSchema = z.union([
  checkoutPreflightFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    decisions: z.array(inventoryReservationCreationApplySchema).max(500),
  }),
]);
export type CheckoutInventoryAssignment = z.infer<
  typeof checkoutInventoryAssignmentSchema
>;
export type CheckoutInventorySelection = z.infer<
  typeof checkoutInventorySelectionSchema
>;
export type CheckoutInventoryPlanCommand = z.infer<
  typeof checkoutInventoryPlanCommandSchema
>;
export type CheckoutInventoryPlan = z.infer<typeof checkoutInventoryPlanSchema>;
