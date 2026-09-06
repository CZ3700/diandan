import {
  giftCommerceResponseSchema,
  type GiftCommerceCommandInput,
} from "@fan-support/contracts";
import type { AdminClient } from "./client";
type WithoutKey<T> = T extends { idempotencyKey: string }
  ? Omit<T, "idempotencyKey">
  : T;
export type CommerceInput = WithoutKey<GiftCommerceCommandInput>;
const operations = {
  CONTEXT: "commerce-context",
  READ_GIFT: "gift-read",
  CREATE_GIFT: "gift-create",
  SET_GIFT_STATUS: "gift-status",
  SAVE_VARIANT: "gift-variant-save",
  SAVE_GIFT_CONTENT: "gift-content-save",
  READ_PRICES: "prices-read",
  CREATE_PRICE_REVISION: "price-revision-create",
  PUBLISH_PRICE_BOOK: "price-book-publish",
  ROLLBACK_PRICE_BOOK: "price-book-rollback",
  READ_INVENTORY: "inventory-read",
  ADJUST_INVENTORY: "inventory-adjust",
  CREATE_INVENTORY_LOCATION: "inventory-location-create",
} as const;
export function callCommerce(client: AdminClient, command: CommerceInput) {
  return client.call(
    operations[command.action],
    command,
    giftCommerceResponseSchema,
    command.action !== "CONTEXT" && !command.action.startsWith("READ_"),
  );
}
