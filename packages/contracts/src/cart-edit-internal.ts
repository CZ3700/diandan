import { wishGalleryPreferenceSchema } from "./wish-gallery.js";
import { z } from "zod";
import {
  cartRuntimeAccessesSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeItemRecordSchema,
  cartRuntimePrivateContentSchema,
} from "./cart-runtime.js";
import { cartEditQuantitySchema } from "./cart-edit.js";
import { displayModeSchema, fanMessageLocaleSchema } from "./commerce.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import {
  cartIdSchema,
  cartItemIdSchema,
  supportIntentIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const identity = {
  schemaVersion: z.literal(1),
  accesses: cartRuntimeAccessesSchema,
  cartId: cartIdSchema,
};
const target = {
  ...identity,
  itemId: cartItemIdSchema,
  expectedCartVersion: version,
  expectedItemVersion: version,
};
const trace = { requestId: z.uuid(), correlationId: z.uuid() };
export const cartEditLoadItemCommandSchema = z.strictObject(target);
export const cartEditItemSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cart: cartRuntimeHeaderSchema,
    item: cartRuntimeItemRecordSchema,
    supportIntentId: supportIntentIdSchema,
    intentVersion: version,
    fanMessageLocale: fanMessageLocaleSchema,
  })
  .refine(
    (value) => value.item.cartId.toLowerCase() === value.cart.id.toLowerCase(),
    "Item must belong to the authenticated cart",
  );
export const cartEditLoadPrivateCommandSchema = z.strictObject({
  ...target,
  ...trace,
});
export const cartEditPrivateSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    snapshot: cartEditItemSnapshotSchema,
    accessAuditId: z.uuid(),
    privateContent: cartRuntimePrivateContentSchema,
  })
  .refine(
    (value) =>
      (value.snapshot.item.displayMode === "nickname") ===
        (value.privateContent.displayNameCiphertext !== null) &&
      value.snapshot.item.hasFanMessage ===
        (value.privateContent.fanMessageCiphertext !== null),
    "Encrypted content must match the item projection",
  );
export const cartEditConfirmPrivateCommandSchema = z.strictObject({
  ...target,
  ...trace,
  expectedIntentVersion: version,
  accessAuditId: z.uuid(),
});
const personalization = z
  .strictObject({
    kind: z.literal("PERSONALIZATION"),
    displayMode: displayModeSchema,
    fanMessageLocale: fanMessageLocaleSchema,
    privateContent: cartRuntimePrivateContentSchema,
    galleryPreference: wishGalleryPreferenceSchema.optional(),
  })
  .refine(
    (value) =>
      (value.displayMode === "nickname") ===
      (value.privateContent.displayNameCiphertext !== null),
    "Stored display mode must match its encrypted field",
  );
export const cartEditWriteMutationCommandSchema = z.strictObject({
  ...target,
  ...trace,
  expectedIntentVersion: version,
  receiptId: z.uuid(),
  eventId: z.uuid(),
  presentationLocale: supportedLocaleSchema,
  change: z.union([
    cartEditQuantitySchema,
    personalization,
    z.strictObject({ kind: z.literal("REMOVE") }),
  ]),
});
export const cartEditFindMutationReceiptCommandSchema = z.strictObject({
  ...identity,
  receiptId: z.uuid(),
});
export const cartEditMutationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: z.uuid(),
  cartId: cartIdSchema,
  cartItemId: cartItemIdSchema,
  supportIntentId: supportIntentIdSchema,
  mutationKind: z.enum(["QUANTITY", "PERSONALIZATION", "REMOVE"]),
  cartVersion: version,
  itemVersion: version,
  intentVersion: version,
  occurredAt: contentTimestampSchema,
});
export type CartEditLoadItemCommand = z.infer<
  typeof cartEditLoadItemCommandSchema
>;
export type CartEditItemSnapshot = z.infer<typeof cartEditItemSnapshotSchema>;
export type CartEditLoadPrivateCommand = z.infer<
  typeof cartEditLoadPrivateCommandSchema
>;
export type CartEditPrivateSnapshot = z.infer<
  typeof cartEditPrivateSnapshotSchema
>;
export type CartEditConfirmPrivateCommand = z.infer<
  typeof cartEditConfirmPrivateCommandSchema
>;
export type CartEditWriteMutationCommand = z.infer<
  typeof cartEditWriteMutationCommandSchema
>;
export type CartEditFindMutationReceiptCommand = z.infer<
  typeof cartEditFindMutationReceiptCommandSchema
>;
export type CartEditMutationReceipt = z.infer<
  typeof cartEditMutationReceiptSchema
>;
