import { randomUUID } from "node:crypto";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Shared lock order: the caller owns cart/order/attempt; lock wishes before inventory. */
export async function lockOrderWishBindings(
  client: TransactionClient,
  orderId: string,
) {
  await draftRows(
    client,
    `SELECT w.wish_id FROM public.wish_bindings w JOIN public.wish_purchase_links link ON link.wish_id=w.wish_id
    JOIN public.order_items i ON i.id=link.order_item_id WHERE i.order_id=$1::uuid ORDER BY w.wish_id FOR UPDATE OF w`,
    [orderId],
  );
}
/** Called only after the trusted payment application marked this order PAID, on the same transaction client. */
export async function recordPaidWishSupports(
  client: TransactionClient,
  input: { orderId: string; providerEventId: string; supportedAt: string },
) {
  const lines = await draftRows(
    client,
    `SELECT link.wish_id,link.order_item_id FROM public.wish_purchase_links link
    JOIN public.wish_bindings w ON w.wish_id=link.wish_id JOIN public.order_items i ON i.id=link.order_item_id
    JOIN public.orders o ON o.id=i.order_id
    WHERE i.order_id=$1::uuid AND i.gift_kind='WISH' AND i.quantity=1 AND o.payment_status='PAID'
      AND EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.locked_order_id=o.id AND r.cart_item_id=link.cart_item_id
        AND r.gift_variant_id=w.gift_variant_id AND r.location_id=w.inventory_location_id AND r.quantity=1 AND r.status='COMMITTED')
    ORDER BY link.wish_id`,
    [input.orderId],
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO public.wish_supports(wish_id,order_item_id,provider_event_id,supported_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::timestamptz) ON CONFLICT(wish_id) DO NOTHING`,
      [
        line["wish_id"],
        line["order_item_id"],
        input.providerEventId,
        input.supportedAt,
      ],
    );
    // A concurrent or historical winner is never replaced. PRIVATE supports still consume the wish.
    await client.query(
      `INSERT INTO public.wish_gallery_entries(entry_id,order_item_id,created_at)
      SELECT $1::uuid,s.order_item_id,s.supported_at FROM public.wish_supports s
      WHERE s.wish_id=$2::uuid AND s.order_item_id=$3::uuid ON CONFLICT(order_item_id) DO NOTHING`,
      [randomUUID(), line["wish_id"], line["order_item_id"]],
    );
  }
}
