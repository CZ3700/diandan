import { z } from "zod";
import {
  cartRuntimeAddCommandSchema,
  cartRuntimeFailureCodeSchema,
  cartRuntimeQuantitySchema,
  cartRuntimeResponseSchema,
  cartRuntimeViewSchema,
} from "./cart-runtime.js";
import { cartItemIdSchema, priceIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const target = {
  schemaVersion: z.literal(1),
  itemId: cartItemIdSchema,
  expectedCartVersion: version,
  expectedItemVersion: version,
  presentationLocale: supportedLocaleSchema,
};
const anonymous = cartRuntimeAddCommandSchema.options[0].pick({
  displayMode: true,
  fanMessage: true,
  fanMessageLocale: true,
});
const nickname = cartRuntimeAddCommandSchema.options[1].pick({
  displayMode: true,
  displayName: true,
  fanMessage: true,
  fanMessageLocale: true,
});
/** Explicitly authorized editor response only; never part of a public cart view. */
export const cartEditorContentSchema = z.discriminatedUnion("displayMode", [
  anonymous,
  nickname,
]);
export const cartEditPersonalizationSchema = z.discriminatedUnion(
  "displayMode",
  [
    anonymous.extend({ kind: z.literal("PERSONALIZATION") }),
    nickname.extend({ kind: z.literal("PERSONALIZATION") }),
  ],
);
export const cartEditQuantitySchema = z.strictObject({
  kind: z.literal("QUANTITY"),
  quantity: cartRuntimeQuantitySchema,
  observedPriceId: priceIdSchema,
});
export const cartEditUpdateCommandSchema = z.strictObject({
  ...target,
  operation: z.literal("UPDATE_CART_ITEM"),
  change: z.union([cartEditQuantitySchema, cartEditPersonalizationSchema]),
});
export const cartEditRemoveCommandSchema = z.strictObject({
  ...target,
  operation: z.literal("REMOVE_CART_ITEM"),
});
export const cartEditorReadCommandSchema = z.strictObject({
  ...target,
  operation: z.literal("READ_CART_ITEM_EDITOR"),
});
export const cartEditCommandSchema = z.union([
  cartEditUpdateCommandSchema,
  cartEditRemoveCommandSchema,
  cartEditorReadCommandSchema,
]);
export const cartEditFailureCodeSchema = z.enum([
  ...cartRuntimeFailureCodeSchema.options,
  "ITEM_NOT_FOUND",
  "VERSION_CONFLICT",
  "CART_ITEM_REMOVED",
]);
export const cartEditFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("FAILURE"),
  code: cartEditFailureCodeSchema,
});
export const cartEditResponseSchema = z.union([
  cartEditFailureSchema,
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      action: z.enum(["UPDATED", "REMOVED", "REPLAYED"]),
      cartItemId: cartItemIdSchema,
      cart: cartRuntimeViewSchema,
    })
    .superRefine((value, context) => {
      const present = value.cart.items.some(
        (item) => item.id.toLowerCase() === value.cartItemId.toLowerCase(),
      );
      if (
        (value.action === "UPDATED" && !present) ||
        (value.action === "REMOVED" && present)
      )
        context.addIssue({
          code: "custom",
          message: "Mutation result must match current cart visibility",
        });
    }),
]);
export const cartEditorResponseSchema = z.union([
  cartEditFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.literal("EDITOR_READ"),
    cartItemId: cartItemIdSchema,
    cartVersion: version,
    itemVersion: version,
    content: cartEditorContentSchema,
  }),
]);
/** A deleted item cannot be revived to satisfy the historical add response schema. */
export const cartRuntimeCurrentResponseSchema = z.union([
  cartRuntimeResponseSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("FAILURE"),
    code: z.literal("CART_ITEM_REMOVED"),
  }),
]);
export type CartEditUpdateCommand = z.infer<typeof cartEditUpdateCommandSchema>;
export type CartEditRemoveCommand = z.infer<typeof cartEditRemoveCommandSchema>;
export type CartEditorReadCommand = z.infer<typeof cartEditorReadCommandSchema>;
export type CartEditCommand = z.infer<typeof cartEditCommandSchema>;
export type CartEditQuantity = z.infer<typeof cartEditQuantitySchema>;
export type CartEditPersonalization = z.infer<
  typeof cartEditPersonalizationSchema
>;
export type CartEditFailureCode = z.infer<typeof cartEditFailureCodeSchema>;
export type CartEditFailure = z.infer<typeof cartEditFailureSchema>;
export type CartEditResponse = z.infer<typeof cartEditResponseSchema>;
export type CartEditorContent = z.infer<typeof cartEditorContentSchema>;
export type CartEditorResponse = z.infer<typeof cartEditorResponseSchema>;
export type CartRuntimeCurrentResponse = z.infer<
  typeof cartRuntimeCurrentResponseSchema
>;
