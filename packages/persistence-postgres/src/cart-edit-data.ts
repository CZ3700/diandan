import { Buffer } from "node:buffer";
import {
  cartEditItemSnapshotSchema,
  cartEditMutationReceiptSchema,
  cartRuntimePrivateContentSchema,
  type CartEditLoadItemCommand,
  type CartRuntimeAccesses,
} from "@fan-support/contracts";
import { CartEditRepositoryError } from "@fan-support/persistence-port";
import { cartItemRecord, findCartForUpdate } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export const rejectCartEdit = (
  code: ConstructorParameters<typeof CartEditRepositoryError>[0],
): never => {
  throw new CartEditRepositoryError(code);
};
export async function authorizedEditCart(
  client: TransactionClient,
  accesses: CartRuntimeAccesses,
  cartId: string,
  editable = true,
) {
  const cart = await findCartForUpdate(client, accesses);
  if (!cart || cart.id.toLowerCase() !== cartId.toLowerCase())
    return rejectCartEdit("INVALID_ACCESS");
  if (cart.expired || cart.status === "EXPIRED")
    return rejectCartEdit("CART_EXPIRED");
  if (editable && cart.status !== "ACTIVE")
    return rejectCartEdit("CART_LOCKED");
  return cart;
}
export async function loadEditableCartItem(
  client: TransactionClient,
  command: CartEditLoadItemCommand,
) {
  const cart = await authorizedEditCart(
    client,
    command.accesses,
    command.cartId,
  );
  if (cart.version !== command.expectedCartVersion)
    return rejectCartEdit("VERSION_CONFLICT");
  const rows = await draftRows(
    client,
    `SELECT item.id,item.cart_id,variant.gift_id,item.gift_variant_id,intent.idol_id,
 preference.visibility gallery_visibility,preference.public_alias gallery_public_alias,
 item.version::text,item.quantity,item.observed_price_id,item.display_mode,item.has_fan_message,
 intent.id support_intent_id,intent.version::text intent_version,intent.fan_message_locale,
 intent.status intent_status,intent.privacy_state,intent.expires_at<=clock_timestamp() intent_expired
 FROM public.cart_items item JOIN public.support_intents intent ON intent.cart_item_id=item.id
 JOIN public.gift_variants variant ON variant.id=item.gift_variant_id
 LEFT JOIN public.cart_wish_gallery_preferences preference ON preference.cart_item_id=item.id
 WHERE item.id=$1::uuid AND item.cart_id=$2::uuid FOR UPDATE OF item,intent`,
    [command.itemId, cart.id],
  );
  if (rows.length > 1) return rejectCartEdit("CONTENT_UNAVAILABLE");
  const row = rows[0];
  if (!row) return null;
  if (row["intent_status"] === "CANCELED")
    return rejectCartEdit("CART_ITEM_REMOVED");
  if (row["intent_expired"] === true || row["intent_status"] === "EXPIRED")
    return rejectCartEdit("CART_EXPIRED");
  if (row["intent_status"] !== "ACTIVE" || row["privacy_state"] !== "ACTIVE")
    return rejectCartEdit("CART_LOCKED");
  if (Number(row["version"]) !== command.expectedItemVersion)
    return rejectCartEdit("VERSION_CONFLICT");
  return cartEditItemSnapshotSchema.parse({
    schemaVersion: 1,
    cart,
    item: cartItemRecord(row),
    supportIntentId: row["support_intent_id"],
    intentVersion: Number(row["intent_version"]),
    fanMessageLocale: row["fan_message_locale"],
  });
}
const encoded = (value: unknown) =>
  value === null
    ? null
    : Buffer.isBuffer(value)
      ? `enc:v1:${value.toString("base64url")}`
      : rejectCartEdit("CONTENT_UNAVAILABLE");
export function privateContentFromRow(row: DraftRow) {
  return cartRuntimePrivateContentSchema.parse({
    fanMessageCiphertext: encoded(row["fan_message_ciphertext"]),
    displayNameCiphertext: encoded(row["display_name_ciphertext"]),
    encryptedDataKey: encoded(row["encrypted_data_key"]),
    encryptionKeyVersion: row["encryption_key_version"],
  });
}
export const cartEditEncryptedBytes = (value: string | null) =>
  value === null
    ? null
    : Buffer.from(value.slice("enc:v1:".length), "base64url");
export function cartMutationReceipt(row: DraftRow) {
  return cartEditMutationReceiptSchema.parse({
    schemaVersion: 1,
    receiptId: row["receipt_id"],
    cartId: row["cart_id"],
    cartItemId: row["cart_item_id"],
    supportIntentId: row["support_intent_id"],
    mutationKind: row["mutation_kind"],
    cartVersion: Number(row["cart_version"]),
    itemVersion: Number(row["item_version"]),
    intentVersion: Number(row["intent_version"]),
    occurredAt: row["occurred_at"],
  });
}
