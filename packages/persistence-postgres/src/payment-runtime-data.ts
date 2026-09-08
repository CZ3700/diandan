import { Buffer } from "node:buffer";
import {
  checkoutPreflightSessionRecordSchema,
  paymentRuntimeAttemptRecordSchema,
  paymentRuntimeCreateReceiptSchema,
  type CartRuntimeAccesses,
  type PaymentRuntimeFailureCode,
} from "@fan-support/contracts";
import { PaymentRuntimeRepositoryError } from "@fan-support/persistence-port";
import { findCartForUpdate, cartTimestamp } from "./cart-runtime-data.js";
import {
  checkoutReceipt,
  checkoutReceiptColumns,
  readCheckoutObservation,
} from "./checkout-preflight-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const rejectPayment = (code: PaymentRuntimeFailureCode): never => {
  throw new PaymentRuntimeRepositoryError(code);
};
export async function authorizePaymentCart(
  client: TransactionClient,
  accesses: CartRuntimeAccesses,
) {
  const cart = await findCartForUpdate(client, accesses);
  if (!cart) return rejectPayment("INVALID_ACCESS");
  if (cart.expired || cart.status === "EXPIRED")
    return rejectPayment("CART_EXPIRED");
  return cart;
}
export async function loadPaymentCheckout(
  client: TransactionClient,
  cartId: string,
  sessionId: string,
) {
  const [receiptRow] = await draftRows(
    client,
    `SELECT ${checkoutReceiptColumns} FROM public.checkout_preflight_receipts WHERE cart_id=$1::uuid AND checkout_session_id=$2::uuid`,
    [cartId, sessionId],
  );
  if (!receiptRow) return null;
  const receipt = checkoutReceipt(receiptRow);
  const observation = await readCheckoutObservation(
    client,
    cartId,
    receipt.preflightId,
  );
  const [row] = await draftRows(
    client,
    `SELECT s.status,o.order_status,o.payment_status,s.quote_expires_at<=clock_timestamp() expired,${cartTimestamp("clock_timestamp()")} evaluated_at FROM public.checkout_sessions s JOIN public.orders o ON o.checkout_session_id=s.id AND o.cart_id=s.cart_id WHERE s.id=$1::uuid AND s.cart_id=$2::uuid FOR UPDATE OF s,o`,
    [sessionId, cartId],
  );
  if (!row) return rejectPayment("CONTENT_UNAVAILABLE");
  return checkoutPreflightSessionRecordSchema.parse({
    schemaVersion: 1,
    receipt,
    observation,
    evaluatedAt: row["evaluated_at"],
    expired: row["expired"],
    status: row["status"],
    orderStatus: row["order_status"],
    paymentStatus: row["payment_status"],
  });
}
export async function loadPermanentPaymentReceipt(
  client: TransactionClient,
  cartId: string,
  sessionId: string,
  key: string,
) {
  const rows = await draftRows(
    client,
    `SELECT jsonb_build_object('schemaVersion',1,'receiptId',r.id,'operationId',r.operation_id,'cartId',r.cart_id,'checkoutSessionId',r.checkout_session_id,'attemptId',r.attempt_id,'idempotencyKey',r.idempotency_key,'canonicalRequestHash',r.canonical_request_hash,'occurredAt',${cartTimestamp("r.created_at")}) receipt FROM public.payment_create_receipts r WHERE r.cart_id=$1::uuid AND r.checkout_session_id=$2::uuid AND r.idempotency_key=$3`,
    [cartId, sessionId, key],
  );
  if (rows.length > 1) return rejectPayment("CONTENT_UNAVAILABLE");
  return rows[0]
    ? paymentRuntimeCreateReceiptSchema.parse(rows[0]["receipt"])
    : null;
}

export const validPaymentReservationsSql = `NOT EXISTS (
  SELECT 1 FROM public.order_items item
  JOIN public.gift_variants variant ON variant.id=item.gift_variant_id
  JOIN public.support_intents intent ON intent.id=item.support_intent_id
  WHERE item.order_id=o.id AND (
    intent.status<>'CHECKOUT_LOCKED' OR intent.privacy_state<>'ACTIVE' OR intent.expires_at<=clock_timestamp()
    OR (variant.inventory_policy='TRACKED' AND (
      (SELECT count(*) FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id AND r.status='ACTIVE')<>1
      OR NOT EXISTS (SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.checkout_quote_id=o.checkout_quote_id AND r.cart_item_id=item.cart_item_id AND r.gift_variant_id=item.gift_variant_id AND r.locked_order_id=o.id AND r.quantity=item.quantity AND r.status='ACTIVE' AND r.expires_at>clock_timestamp())
    ))
    OR (variant.inventory_policy<>'TRACKED' AND EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=o.checkout_session_id AND r.cart_item_id=item.cart_item_id))
  )
)`;

export const encodedPaymentValue = (value: string) =>
  Buffer.from(value.slice("enc:v1:".length), "base64url");
const decodedPaymentValue = (value: unknown) => {
  if (!Buffer.isBuffer(value)) return rejectPayment("CONTENT_UNAVAILABLE");
  return `enc:v1:${value.toString("base64url")}`;
};
export function paymentAttemptRecord(row: DraftRow) {
  const status = row["status"];
  let action = null;
  if (row["action_type"] === "WAIT")
    action = {
      schemaVersion: 1,
      type: "WAIT",
      pollAfterMs: row["action_poll_after_ms"],
    };
  else if (row["action_type"] !== null)
    action = {
      schemaVersion: 1,
      type: row["action_type"],
      ciphertext: decodedPaymentValue(row["action_ciphertext"]),
      encryptedDataKey: decodedPaymentValue(row["action_encrypted_data_key"]),
      encryptionKeyVersion: row["action_key_version"],
      expiresAt: row["action_expires_at"],
    };
  return paymentRuntimeAttemptRecordSchema.parse({
    schemaVersion: 1,
    id: row["id"],
    cartId: row["cart_id"],
    checkoutSessionId: row["checkout_session_id"],
    orderId: row["order_id"],
    providerAccountId: row["provider_account_id"],
    adapterKey: row["adapter_key"],
    environment: row["environment"],
    paymentMethod: row["payment_method"],
    amountMinor: Number(row["amount_minor"]),
    market: row["market"],
    currency: row["currency"],
    requestedLocale: row["requested_locale"],
    providerLocale: row["provider_locale"],
    providerLocaleFallbackUsed: row["provider_locale_fallback_used"],
    configVersionId: row["config_version_id"],
    configVersion: Number(row["config_version"]),
    routeRuleId: row["route_rule_id"],
    ruleVersion: Number(row["rule_version"]),
    merchantReference: row["merchant_reference"],
    providerIdempotencyKey: row["provider_idempotency_key"],
    externalReference: row["external_reference"],
    status,
    version: Number(row["version"]),
    providerCallStarted: row["provider_call_started"],
    action,
    recovery:
      row["phase"] === "EVIDENCE_PENDING"
        ? "EVIDENCE_PENDING"
        : status === "CREATED"
          ? "CREATE_PENDING"
          : status === "UNKNOWN"
            ? "RECONCILE_REQUIRED"
            : "NONE",
    canRetry: row["can_retry"],
    actionExpired: row["action_expired"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  });
}
export async function loadPaymentAttempt(
  client: TransactionClient,
  attemptId: string,
  cartId?: string,
  sessionId?: string,
) {
  const rows = await draftRows(
    client,
    `SELECT a.*,o.cart_id,o.checkout_session_id,o.market,p.adapter_key,operation.phase,
    ${cartTimestamp("a.created_at")} created_at,${cartTimestamp("a.updated_at")} updated_at,${cartTimestamp("a.action_expires_at")} action_expires_at,
    (a.action_expires_at IS NOT NULL AND a.action_expires_at<=clock_timestamp()) action_expired,
    (a.status IN('FAILED','CANCELED','EXPIRED') AND o.order_status='PENDING_PAYMENT' AND o.payment_status IN('UNPAID','PENDING') AND o.quote_expires_at>clock_timestamp() AND ${validPaymentReservationsSql}) can_retry
    FROM public.payment_attempts a JOIN public.orders o ON o.id=a.order_id JOIN public.payment_provider_accounts p ON p.id=a.provider_account_id AND p.environment=a.environment LEFT JOIN public.payment_runtime_operations operation ON operation.attempt_id=a.id
    WHERE a.id=$1::uuid AND ($2::uuid IS NULL OR o.cart_id=$2::uuid) AND ($3::uuid IS NULL OR o.checkout_session_id=$3::uuid) FOR UPDATE OF a,o`,
    [attemptId, cartId ?? null, sessionId ?? null],
  );
  if (rows.length > 1) return rejectPayment("CONTENT_UNAVAILABLE");
  return rows[0] ? paymentAttemptRecord(rows[0]) : null;
}

/** Payment history requires strictly increasing instants; lease/quote expiry still uses the real PG wall clock. */
export async function paymentEventTime(
  client: TransactionClient,
  orderId: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT ${cartTimestamp("GREATEST(clock_timestamp(),o.updated_at+interval '1 microsecond',coalesce((SELECT max(a.updated_at)+interval '1 microsecond' FROM public.payment_attempts a WHERE a.order_id=o.id),o.updated_at))")} event_time FROM public.orders o WHERE o.id=$1::uuid`,
    [orderId],
  );
  if (typeof row?.["event_time"] !== "string")
    return rejectPayment("CONTENT_UNAVAILABLE");
  return row["event_time"];
}
