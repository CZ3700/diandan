import {
  cartEditUpdateCommandSchema,
  cartEditRemoveCommandSchema,
  cartEditorReadCommandSchema,
} from "./cart-edit.js";
export const cartEditUpdateRequestSchema = cartEditUpdateCommandSchema.omit({
  operation: true,
  itemId: true,
});
export const cartEditRemoveRequestSchema = cartEditRemoveCommandSchema.omit({
  operation: true,
  itemId: true,
});
export const cartEditorReadRequestSchema = cartEditorReadCommandSchema.omit({
  operation: true,
  itemId: true,
});
