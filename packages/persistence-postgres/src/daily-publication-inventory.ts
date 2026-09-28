import {
  giftCommerceMutationSchema,
  giftCommerceWriteCommandSchema,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { writeCommerceInventory } from "./gift-commerce-inventory-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Save the operator's target quantity using the canonical stock ledger in the same transaction. */
export async function publishDailyGiftInventory(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  variantId: string,
  eventTime: string,
): Promise<void> {
  if (claim.intent.kind !== "SAVE_GIFT")
    throw new Error("Daily inventory requires a gift");
  if (
    "commerceEdit" in claim.intent &&
    claim.intent.commerceEdit.inventory.mode === "PRESERVE"
  )
    return;
  const inventory = claim.intent.inventory;
  if (inventory.policy !== "TRACKED") return;
  const [variant] = await draftRows(
    client,
    "SELECT version FROM public.gift_variants WHERE id=$1 AND inventory_policy='TRACKED' FOR UPDATE",
    [variantId],
  );
  if (!variant) throw new Error("Daily inventory variant unavailable");
  const [balance] = await draftRows(
    client,
    `SELECT b.on_hand,b.reserved,b.version FROM public.inventory_items i JOIN public.inventory_balances b ON b.inventory_item_id=i.id WHERE i.gift_variant_id=$1 AND b.location_id=$2 AND i.status='ACTIVE' AND i.policy='TRACKED' FOR UPDATE OF i,b`,
    [variantId, inventory.locationId],
  );
  const onHand = Number(balance?.["on_hand"] ?? 0),
    reserved = Number(balance?.["reserved"] ?? 0),
    version = Number(balance?.["version"] ?? 0);
  if (inventory.quantity < reserved)
    throw new Error("Daily inventory cannot remove reserved stock");
  const deltaOnHand = inventory.quantity - onHand;
  // No balance means no stock. Do not invent a zero-valued stock receipt.
  if (deltaOnHand === 0) return;
  const result = giftCommerceMutationSchema.parse(
    await writeCommerceInventory(
      client,
      giftCommerceWriteCommandSchema.parse({
        schemaVersion: 1,
        principal: {
          schemaVersion: 1,
          actorId: claim.actorId,
          sessionId: claim.sessionId,
          authorizedAt: eventTime,
          expiresAt: claim.authorizedUntil,
        },
        requestId: claim.requestId,
        command: {
          schemaVersion: 1,
          action: "ADJUST_INVENTORY",
          giftVariantId: variantId,
          inventoryLocationId: inventory.locationId,
          expectedVariantVersion: Number(variant["version"]),
          expectedBalanceVersion: version,
          deltaOnHand,
          reasonCode: "MANAGEMENT_GIFT_STOCK",
          idempotencyKey: claim.operation.operationId,
        },
      }),
    ),
  );
  if (
    result.action !== "ADJUST_INVENTORY" ||
    result.giftVariantId !== variantId ||
    result.inventoryLocationId !== inventory.locationId ||
    result.balanceVersion !== version + 1
  )
    throw new Error("Daily inventory receipt mismatch");
}
