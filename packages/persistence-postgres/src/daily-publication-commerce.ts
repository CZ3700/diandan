import type { ManagementCenterClaim } from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  priceContext,
  loadCommerceBook,
} from "./gift-commerce-pricing-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Compare operator baselines while holding the same locks as commerce writers, before any content write. */
export async function validateDailyGiftCommerceEdit(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  giftVariantId: string,
): Promise<boolean> {
  const intent = claim.intent;
  if (intent.kind !== "SAVE_GIFT" || !("commerceEdit" in intent)) return true;
  const { price, inventory } = intent.commerceEdit;
  const [variant] = await draftRows(
    client,
    "SELECT inventory_policy FROM public.gift_variants WHERE id=$1 AND gift_id=$2 AND status<>'archived' FOR UPDATE",
    [giftVariantId, intent.id],
  );
  if (!variant) return false;
  if (price.mode === "SET") {
    const baseline = price.baseline;
    if (
      baseline.market !== intent.price.market ||
      baseline.currency !== intent.price.currency
    )
      return false;
    const current = await priceContext(
      client,
      baseline.market,
      baseline.currency,
      true,
    );
    if (!current?.head || current.owner["status"] !== "ACTIVE") return false;
    const source = await loadCommerceBook(
      client,
      String(current.head["price_book_id"]),
      Number(current.head["price_book_revision"]),
      true,
    );
    const prior = source?.prices.find(
      (row) =>
        String(row["giftVariantId"]).toLowerCase() ===
        giftVariantId.toLowerCase(),
    );
    if (
      !source?.book.singleWindow ||
      !prior ||
      Number(prior["unitAmountMinor"]) !== baseline.amountMinor
    )
      return false;
  }
  if (inventory.mode === "SET") {
    const baseline = inventory.baseline;
    if (
      baseline.policy === "TRACKED" &&
      intent.inventory.policy === "TRACKED" &&
      baseline.locationId !== intent.inventory.locationId
    )
      return false;
    if (variant["inventory_policy"] !== baseline.policy) return false;
    const [item] = await draftRows(
      client,
      "SELECT id,status,policy FROM public.inventory_items WHERE gift_variant_id=$1 FOR UPDATE",
      [giftVariantId],
    );
    if (
      item &&
      (item["status"] !== "ACTIVE" || item["policy"] !== baseline.policy)
    )
      return false;
    if (baseline.policy === "TRACKED") {
      const [location] = await draftRows(
        client,
        "SELECT id FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
        [baseline.locationId],
      );
      if (!location) return false;
      const [balance] = item
        ? await draftRows(
            client,
            "SELECT on_hand FROM public.inventory_balances WHERE inventory_item_id=$1 AND location_id=$2 FOR UPDATE",
            [item["id"], baseline.locationId],
          )
        : [];
      if (Number(balance?.["on_hand"] ?? 0) !== baseline.quantity) return false;
    }
  }
  return true;
}
