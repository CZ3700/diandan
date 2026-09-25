import {
  checkoutPreflightObservationSchema,
  checkoutPreflightReceiptSchema,
  type CartRuntimeAccesses,
  type CheckoutPreflightFailureCode,
} from "@fan-support/contracts";
import { CheckoutPreflightRepositoryError } from "@fan-support/persistence-port";
import { cartTimestamp, findCartForUpdate } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const rejectCheckout = (code: CheckoutPreflightFailureCode): never => {
  throw new CheckoutPreflightRepositoryError(code);
};
export async function authorizeCheckout(
  client: TransactionClient,
  accesses: CartRuntimeAccesses,
  cartId: string,
  editable = true,
) {
  const cart = await findCartForUpdate(client, accesses);
  if (!cart || cart.id.toLowerCase() !== cartId.toLowerCase())
    return rejectCheckout("INVALID_ACCESS");
  if (cart.expired || cart.status === "EXPIRED")
    return rejectCheckout("CART_EXPIRED");
  if (editable && cart.status !== "ACTIVE")
    return rejectCheckout("CART_LOCKED");
  return cart;
}
export async function readCheckoutObservation(
  client: TransactionClient,
  cartId: string,
  preflightId: string,
) {
  const rows = await draftRows(
    client,
    `SELECT observation FROM public.checkout_preflight_observations WHERE id=$1::uuid AND cart_id=$2::uuid FOR SHARE`,
    [preflightId, cartId],
  );
  if (rows.length > 1) return rejectCheckout("CONTENT_UNAVAILABLE");
  return rows[0]
    ? checkoutPreflightObservationSchema.parse(rows[0]["observation"])
    : null;
}
export async function checkoutEventTime(
  client: TransactionClient,
  cartId: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT ${cartTimestamp("GREATEST(clock_timestamp(),c.updated_at,coalesce((SELECT max(s.updated_at) FROM public.support_intents s JOIN public.cart_items i ON i.id=s.cart_item_id WHERE i.cart_id=c.id),c.updated_at))")} event_time FROM public.carts c WHERE c.id=$1::uuid`,
    [cartId],
  );
  if (!row || typeof row["event_time"] !== "string")
    return rejectCheckout("CONTENT_UNAVAILABLE");
  return row["event_time"];
}
export const checkoutReceiptColumns = `preflight_id,cart_id,cart_version::text,checkout_session_id,order_id,public_order_id,${cartTimestamp("occurred_at")} occurred_at`;
export function checkoutReceipt(row: DraftRow) {
  return checkoutPreflightReceiptSchema.parse({
    schemaVersion: 1,
    preflightId: row["preflight_id"],
    cartId: row["cart_id"],
    cartVersion: Number(row["cart_version"]),
    checkoutSessionId: row["checkout_session_id"],
    orderId: row["order_id"],
    publicOrderId: row["public_order_id"],
    occurredAt: row["occurred_at"],
  });
}
