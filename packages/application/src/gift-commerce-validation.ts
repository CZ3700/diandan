import type {
  GiftCommerceCommand,
  GiftCommerceMutation,
  GiftCommerceReadResponse,
} from "@fan-support/contracts";
import {
  sameCommerceId as sameId,
  rejectCommerce,
} from "./gift-commerce-results.js";

export function validateCommerceMutation(
  command: Extract<GiftCommerceCommand, { idempotencyKey: string }>,
  result: GiftCommerceMutation,
): void {
  if (result.action !== command.action) rejectCommerce("COMMERCE_UNAVAILABLE");
  let valid = false;
  switch (command.action) {
    case "CREATE_GIFT":
    case "SET_GIFT_STATUS":
      valid =
        (result.action === "CREATE_GIFT" ||
          result.action === "SET_GIFT_STATUS") &&
        result.baseVersion === command.expectedBaseVersion + 1 &&
        (command.action === "CREATE_GIFT" ||
          sameId(result.giftId, command.giftId));
      break;
    case "SAVE_VARIANT":
      valid =
        result.action === "SAVE_VARIANT" &&
        sameId(result.giftId, command.giftId) &&
        result.variantVersion === command.expectedVariantVersion + 1 &&
        (command.giftVariantId === null ||
          sameId(result.giftVariantId, command.giftVariantId));
      break;
    case "SAVE_GIFT_CONTENT":
      valid =
        result.action === "SAVE_GIFT_CONTENT" &&
        sameId(result.giftId, command.authoring.target.giftId) &&
        result.authoringVersion === command.authoring.expectedVersion + 1;
      break;
    case "CREATE_PRICE_REVISION":
      valid =
        result.action === "CREATE_PRICE_REVISION" &&
        result.market === command.market &&
        result.currency === command.currency &&
        result.revision === command.expectedBookRevision + 1 &&
        result.headVersion === command.expectedHeadVersion &&
        (command.source === null ||
          sameId(result.priceBookId, command.source.priceBookId));
      break;
    case "PUBLISH_PRICE_BOOK":
    case "ROLLBACK_PRICE_BOOK":
      valid =
        (result.action === "PUBLISH_PRICE_BOOK" ||
          result.action === "ROLLBACK_PRICE_BOOK") &&
        result.market === command.market &&
        result.currency === command.currency &&
        sameId(result.priceBookId, command.priceBookId) &&
        result.revision === command.revision &&
        result.headVersion === command.expectedHeadVersion + 1 &&
        result.contentHash === command.expectedContentHash;
      break;
    case "CREATE_INVENTORY_LOCATION":
      valid = result.action === "CREATE_INVENTORY_LOCATION";
      break;
    case "ADJUST_INVENTORY":
      valid =
        result.action === "ADJUST_INVENTORY" &&
        sameId(result.giftVariantId, command.giftVariantId) &&
        sameId(result.inventoryLocationId, command.inventoryLocationId) &&
        result.balanceVersion === command.expectedBalanceVersion + 1;
      break;
  }
  if (!valid) rejectCommerce("COMMERCE_UNAVAILABLE");
}

export function validateCommerceRead(
  command: Exclude<GiftCommerceCommand, { idempotencyKey: string }>,
  result: Extract<GiftCommerceReadResponse, { outcome: "SUCCESS" }>,
): void {
  switch (command.action) {
    case "CONTEXT":
      if (result.kind !== "COMMERCE_CONTEXT")
        rejectCommerce("COMMERCE_UNAVAILABLE");
      break;
    case "READ_GIFT":
      if (
        result.kind !== "GIFT" ||
        !sameId(result.value.gift.id, command.giftId) ||
        result.value.locale !== command.locale ||
        (command.revisionId !== undefined &&
          !sameId(result.value.selectedRevisionId ?? "", command.revisionId))
      )
        rejectCommerce("COMMERCE_UNAVAILABLE");
      break;
    case "READ_PRICES":
      if (
        (result.kind !== "PRICE_BOOKS" && result.kind !== "PRICES") ||
        result.market !== command.market ||
        result.currency !== command.currency ||
        result.page !== command.page ||
        result.pageSize !== command.pageSize ||
        (command.revision === null
          ? result.kind !== "PRICE_BOOKS"
          : result.kind !== "PRICES" ||
            result.book.revision !== command.revision)
      )
        rejectCommerce("COMMERCE_UNAVAILABLE");
      break;
    case "READ_INVENTORY":
      if (
        (result.kind !== "INVENTORY_BALANCES" &&
          result.kind !== "INVENTORY_LEDGER") ||
        result.kind !== `INVENTORY_${command.view}` ||
        !sameId(result.giftVariantId, command.giftVariantId) ||
        (result.inventoryLocationId === null
          ? command.inventoryLocationId !== null
          : command.inventoryLocationId === null ||
            !sameId(result.inventoryLocationId, command.inventoryLocationId)) ||
        result.page !== command.page ||
        result.pageSize !== command.pageSize
      )
        rejectCommerce("COMMERCE_UNAVAILABLE");
      if (
        result.item === null
          ? result.items.length > 0
          : !sameId(result.item.giftVariantId, command.giftVariantId) ||
            result.items.some(
              (row) =>
                !sameId(row.inventoryItemId, result.item!.id) ||
                (command.inventoryLocationId !== null &&
                  !sameId(
                    row.inventoryLocationId,
                    command.inventoryLocationId,
                  )),
            )
      )
        rejectCommerce("COMMERCE_UNAVAILABLE");
      break;
  }
}
