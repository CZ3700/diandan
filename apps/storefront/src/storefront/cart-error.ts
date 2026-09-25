import type { StorefrontCopy } from "./copy";
import type { CartResult } from "./cart-session";
export function cartError(
  result: Exclude<CartResult, { outcome: "SUCCESS" }>,
  copy: StorefrontCopy,
): string {
  if (result.outcome === "UNKNOWN") return copy.cartUnknown;
  switch (result.code) {
    case "TRANSACTION_OUTCOME_UNKNOWN":
    case "IN_PROGRESS":
      return copy.cartUnknown;
    case "VERSION_CONFLICT":
      return copy.cartConflict;
    case "CART_ITEM_REMOVED":
    case "ITEM_NOT_FOUND":
      return copy.cartRemoved;
    case "PRICE_CHANGED":
      return copy.cartPriceChanged;
    case "INSUFFICIENT_STOCK":
    case "QUANTITY_EXCEEDED":
      return copy.cartQuantityExceeded;
    case "SCOPE_MISMATCH":
      return copy.cartScopeMismatch;
    case "INVALID_COMMAND":
      return copy.cartInvalid;
    case "CART_EXPIRED":
    case "CART_NOT_FOUND":
      return copy.cartExpired;
    default:
      return copy.cartUnavailable;
  }
}
export function isUncertain(result: CartResult): boolean {
  return (
    result.outcome === "UNKNOWN" ||
    (result.outcome === "FAILURE" &&
      (result.code === "TRANSACTION_OUTCOME_UNKNOWN" ||
        result.code === "IN_PROGRESS" ||
        result.code === "TEMPORARY_UNAVAILABLE"))
  );
}
