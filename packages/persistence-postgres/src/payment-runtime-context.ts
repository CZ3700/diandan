import {
  paymentRuntimeContextSchema,
  type PaymentRuntimeLoadContextCommand,
} from "@fan-support/contracts";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  authorizePaymentCart,
  loadPaymentAttempt,
  loadPaymentCheckout,
  rejectPayment,
  validPaymentReservationsSql,
} from "./payment-runtime-data.js";
import { loadPaymentRouting } from "./payment-runtime-config.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Locks existing checkout resources; eligibility and expiry use the current PG wall clock. */
export async function paymentCheckoutReadiness(
  client: TransactionClient,
  orderId: string,
) {
  await client.query(
    `SELECT intent.id FROM public.support_intents intent JOIN public.order_items item ON item.support_intent_id=intent.id WHERE item.order_id=$1::uuid ORDER BY intent.id FOR UPDATE OF intent`,
    [orderId],
  );
  await client.query(
    `SELECT r.id FROM public.inventory_reservations r JOIN public.orders o ON o.checkout_session_id=r.checkout_session_id WHERE o.id=$1::uuid ORDER BY r.id FOR UPDATE OF r`,
    [orderId],
  );
  const [row] = await draftRows(
    client,
    `SELECT o.*,${cartTimestamp("clock_timestamp()")} evaluated_at,(o.quote_expires_at>clock_timestamp() AND ${validPaymentReservationsSql}) resources_valid FROM public.orders o WHERE o.id=$1::uuid FOR UPDATE OF o`,
    [orderId],
  );
  if (!row) return rejectPayment("CONTENT_UNAVAILABLE");
  return row;
}
export async function loadPaymentContext(
  client: TransactionClient,
  command: PaymentRuntimeLoadContextCommand,
) {
  const cart = await authorizePaymentCart(client, command.accesses);
  const checkout = await loadPaymentCheckout(
    client,
    cart.id,
    command.checkoutSessionId,
  );
  if (!checkout) return rejectPayment("SESSION_NOT_READY");
  const order = await paymentCheckoutReadiness(
    client,
    checkout.receipt.orderId,
  );
  const currentAttempt =
    typeof order["current_payment_attempt_id"] === "string"
      ? await loadPaymentAttempt(
          client,
          order["current_payment_attempt_id"],
          cart.id,
          command.checkoutSessionId,
        )
      : null;
  const ready =
    cart.status === "LOCKED" &&
    ["READY", "PAYMENT_PENDING"].includes(checkout.status) &&
    order["order_status"] === "PENDING_PAYMENT" &&
    ["UNPAID", "PENDING"].includes(String(order["payment_status"]));
  const routing = ready
    ? await loadPaymentRouting(client, command.presentationLocale)
    : null;
  return paymentRuntimeContextSchema.parse({
    schemaVersion: 1,
    evaluatedAt: order["evaluated_at"],
    cart,
    checkout,
    orderVersion: Number(order["version"]),
    readiness: !ready
      ? "SESSION_NOT_READY"
      : order["resources_valid"] === true
        ? "READY"
        : "RECHECKOUT_REQUIRED",
    currentAttempt,
    routing,
  });
}
