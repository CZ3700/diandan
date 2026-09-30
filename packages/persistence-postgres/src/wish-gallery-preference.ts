import {
  wishGalleryPreferenceSchema,
  type WishGalleryPreference,
} from "@fan-support/contracts";
import type { TransactionClient } from "./transaction-runner.js";

/** The caller already owns the active cart lock and validates the recipient/quantity. */
export async function writeCartWishGalleryPreference(
  client: TransactionClient,
  input: { cartItemId: string; preference?: WishGalleryPreference | undefined },
) {
  const preference = wishGalleryPreferenceSchema.parse(
    input.preference ?? { visibility: "PRIVATE" },
  );
  await client.query(
    `INSERT INTO public.cart_wish_gallery_preferences(cart_item_id,visibility,public_alias) VALUES($1::uuid,$2,$3)
    ON CONFLICT(cart_item_id) DO UPDATE SET visibility=EXCLUDED.visibility,public_alias=EXCLUDED.public_alias,updated_at=clock_timestamp()`,
    [
      input.cartItemId,
      preference.visibility,
      preference.visibility === "PUBLIC_NAMED" ? preference.publicAlias : null,
    ],
  );
}
/** Called exactly once after wish_purchase_links is inserted in the checkout transaction. */
export async function freezeWishGalleryPreference(
  client: TransactionClient,
  input: { cartItemId: string; orderItemId: string },
) {
  await client.query(
    `INSERT INTO public.wish_gallery_consents(order_item_id,visibility,public_alias)
    SELECT link.order_item_id,coalesce(preference.visibility,'PRIVATE'),preference.public_alias
    FROM public.wish_purchase_links link LEFT JOIN public.cart_wish_gallery_preferences preference ON preference.cart_item_id=link.cart_item_id
    WHERE link.order_item_id=$1::uuid AND link.cart_item_id=$2::uuid`,
    [input.orderItemId, input.cartItemId],
  );
}
