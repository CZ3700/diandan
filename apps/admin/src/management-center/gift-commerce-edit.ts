import type {
  ManagementCenterIntent,
  ManagementCenterListItem,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";

type GiftIntent = Extract<ManagementCenterIntent, { kind: "SAVE_GIFT" }>;
type Baseline = Pick<
  Extract<ManagementCenterListItem, { kind: "GIFT" }>,
  "price" | "inventory"
>;
type Next = Pick<GiftIntent, "price" | "inventory">;
type Edit = Extract<GiftIntent, { commerceEdit: unknown }>["commerceEdit"];

/** Changing a photo or text must never write back stock or prices from an old form. */
export function giftCommerceEdit(baseline: Baseline, next: Next): Edit {
  if (!baseline.price || !baseline.inventory)
    throw new AdminClientError("TARGET_CONFLICT");
  const priceUnchanged =
    baseline.price.market === next.price.market &&
    baseline.price.currency === next.price.currency &&
    baseline.price.amountMinor === next.price.amountMinor;
  const inventoryUnchanged =
    baseline.inventory.policy === next.inventory.policy &&
    (baseline.inventory.policy !== "TRACKED" ||
      (next.inventory.policy === "TRACKED" &&
        baseline.inventory.locationId === next.inventory.locationId &&
        baseline.inventory.quantity === next.inventory.quantity));
  return {
    price: priceUnchanged
      ? { mode: "PRESERVE" }
      : { mode: "SET", baseline: baseline.price },
    inventory: inventoryUnchanged
      ? { mode: "PRESERVE" }
      : { mode: "SET", baseline: baseline.inventory },
  };
}
