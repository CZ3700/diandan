import { randomUUID } from "node:crypto";
import {
  wishBindingSchema,
  wishGiftSummarySchema,
  type ManagementCenterClaim,
  type SupportedLocale,
  type WishGiftSummary,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function readWishGiftSummary(
  client: TransactionClient,
  giftId: string,
  locale: SupportedLocale,
): Promise<WishGiftSummary | undefined> {
  const [row] = await draftRows(
    client,
    `SELECT b.wish_id,b.idol_id,a.handle,
      coalesce(d.document#>>'{source,fields,displayName}',t.display_name) artist_name,
      CASE WHEN s.wish_id IS NOT NULL THEN 'SUPPORTED'
       WHEN a.status<>'active' OR NOT a.accepting_gifts OR a.published_revision_id IS NULL OR v.status<>'active' OR g.status<>'active' OR i.status IS DISTINCT FROM 'ACTIVE' OR l.status IS DISTINCT FROM 'ACTIVE' THEN 'UNAVAILABLE'
       WHEN coalesce(balance.reserved,0)>0 THEN 'RESERVED'
       WHEN coalesce(balance.on_hand,0)=1 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END wish_status
     FROM public.wish_bindings b JOIN public.idols a ON a.id=b.idol_id JOIN public.gifts g ON g.id=b.gift_id
     JOIN public.gift_variants v ON v.id=b.gift_variant_id
     LEFT JOIN public.daily_publication_revisions d ON d.idol_revision_id=a.published_revision_id
     LEFT JOIN LATERAL(SELECT display_name FROM public.idol_revision_translations WHERE idol_revision_id=a.published_revision_id AND locale IN($2,'en') ORDER BY (locale=$2) DESC LIMIT 1) t ON true
     LEFT JOIN public.inventory_items i ON i.gift_variant_id=b.gift_variant_id
     LEFT JOIN public.inventory_locations l ON l.id=b.inventory_location_id
     LEFT JOIN public.inventory_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=b.inventory_location_id
     LEFT JOIN public.wish_supports s ON s.wish_id=b.wish_id WHERE b.gift_id=$1`,
    [giftId, locale],
  );
  if (!row) return undefined;
  return wishGiftSummarySchema.parse({
    schemaVersion: 1,
    wishId: row["wish_id"],
    artistId: row["idol_id"],
    artistName: row["artist_name"],
    artistHandle: row["handle"],
    status: row["wish_status"],
  });
}

/** Only the daily publication transaction can create a binding; identity never changes. */
export async function prepareDailyWishBinding(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  giftId: string,
  variantId: string,
  at: string,
): Promise<void> {
  if (claim.intent.kind !== "SAVE_GIFT")
    throw new Error("Wish binding requires a gift operation");
  const intent = claim.intent;
  const [existing] = await draftRows(
    client,
    "SELECT * FROM public.wish_bindings WHERE gift_id=$1 FOR UPDATE",
    [giftId],
  );
  if (intent.giftKind !== "WISH") {
    if (existing || intent.eligibility.rule === "SINGLE_ARTIST")
      throw new Error("A bound wish cannot change gift kind");
    return;
  }
  if (
    intent.eligibility.rule !== "SINGLE_ARTIST" ||
    intent.inventory.policy !== "TRACKED"
  )
    throw new Error("Wish requires one artist and tracked stock");
  if (existing) {
    if (
      existing["gift_variant_id"] !== variantId ||
      existing["idol_id"] !== intent.eligibility.idolId ||
      existing["inventory_location_id"] !== intent.inventory.locationId ||
      !("commerceEdit" in intent) ||
      intent.commerceEdit.inventory.mode !== "PRESERVE"
    )
      throw new Error("Wish binding and stock must be preserved");
    return;
  }
  if (intent.inventory.quantity !== 1)
    throw new Error("New wish stock must be one");
  const binding = wishBindingSchema.parse({
    schemaVersion: 1,
    wishId: randomUUID(),
    giftId,
    giftVariantId: variantId,
    idolId: intent.eligibility.idolId,
    inventoryLocationId: intent.inventory.locationId,
  });
  await client.query(
    "INSERT INTO public.wish_bindings(wish_id,gift_id,gift_variant_id,idol_id,inventory_location_id,operation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      binding.wishId,
      giftId,
      variantId,
      binding.idolId,
      binding.inventoryLocationId,
      claim.operation.operationId,
      at,
    ],
  );
}

/** Shared purchase lock order: cart/intent first, all wishes in UUID order, then inventory. */
export async function lockCartWishBindings(
  client: TransactionClient,
  cartId: string,
): Promise<void> {
  await client.query(
    "SELECT b.wish_id FROM public.wish_bindings b WHERE EXISTS(SELECT 1 FROM public.cart_items c WHERE c.cart_id=$1 AND c.gift_variant_id=b.gift_variant_id) ORDER BY b.wish_id FOR UPDATE OF b",
    [cartId],
  );
}

export async function writeWishPurchaseLink(
  client: TransactionClient,
  input: {
    orderItemId: string;
    cartItemId: string;
    giftId: string;
    giftVariantId: string;
    idolId: string;
    quantity: number;
    giftKind: string | null;
  },
): Promise<boolean> {
  const [binding] = await draftRows(
    client,
    "SELECT b.wish_id,public.wish_recipient_allowed($2,$3) allowed FROM public.wish_bindings b WHERE b.gift_id=$1 FOR UPDATE",
    [input.giftId, input.giftVariantId, input.idolId],
  );
  if (input.giftKind !== "WISH") {
    if (binding) throw new Error("Bound wish classification mismatch");
    return false;
  }
  if (!binding || binding["allowed"] !== true || input.quantity !== 1)
    throw new Error("Wish purchase is unavailable");
  await client.query(
    "INSERT INTO public.wish_purchase_links(order_item_id,wish_id,cart_item_id) VALUES($1,$2,$3)",
    [input.orderItemId, binding["wish_id"], input.cartItemId],
  );
  return true;
}
