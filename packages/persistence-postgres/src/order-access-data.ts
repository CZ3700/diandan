import type {
  OrderAccessCandidates,
  OrderAccessFailureCode,
} from "@fan-support/contracts";
import { OrderAccessRepositoryError } from "@fan-support/persistence-port";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const rejectOrderAccess = (code: OrderAccessFailureCode): never => {
  throw new OrderAccessRepositoryError(code);
};
export function candidateBindings(candidates: OrderAccessCandidates) {
  return JSON.stringify(
    candidates.map((candidate) => ({
      digest: candidate.tokenDigest,
      version: candidate.pepperVersion,
    })),
  );
}
export function oneAccessRow(rows: DraftRow[]) {
  if (rows.length !== 1) return rejectOrderAccess("ACCESS_DENIED");
  return rows[0]!;
}
export const orderAccessOrderColumns = `o.id,o.cart_id,o.public_order_id,o.public_order_no,o.presentation_locale,o.order_status,o.payment_status,o.dispute_status,o.fulfillment_status,o.currency,o.subtotal_minor::text,o.tax_amount_minor::text,o.shipping_amount_minor::text,o.fee_amount_minor::text,o.discount_amount_minor::text,o.total_amount_minor::text,${cartTimestamp("o.created_at")} created_at,${cartTimestamp("o.updated_at")} updated_at`;

export async function tokenOwner(
  client: TransactionClient,
  candidates: OrderAccessCandidates,
) {
  return oneAccessRow(
    await draftRows(
      client,
      `SELECT token.order_id,o.cart_id FROM public.order_access_tokens token JOIN public.orders o ON o.id=token.order_id WHERE token.purpose='LINK' AND EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS candidate(digest text,version text) WHERE token.token_digest=decode(candidate.digest,'hex') AND token.token_pepper_version=candidate.version) LIMIT 2`,
      [candidateBindings(candidates)],
    ),
  );
}
export async function sessionOwner(
  client: TransactionClient,
  candidates: OrderAccessCandidates,
  publicOrderId: string,
) {
  return oneAccessRow(
    await draftRows(
      client,
      `SELECT session.order_id,o.cart_id FROM public.order_access_sessions session JOIN public.orders o ON o.id=session.order_id WHERE session.public_order_id=$2::uuid AND EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS candidate(digest text,version text) WHERE session.session_token_digest=decode(candidate.digest,'hex') AND session.token_pepper_version=candidate.version) LIMIT 2`,
      [candidateBindings(candidates), publicOrderId],
    ),
  );
}
export async function lockAccessOrder(
  client: TransactionClient,
  orderId: unknown,
  cartId: unknown,
) {
  oneAccessRow(
    await draftRows(
      client,
      `SELECT id FROM public.carts WHERE id=$1::uuid FOR UPDATE`,
      [cartId],
    ),
  );
  return oneAccessRow(
    await draftRows(
      client,
      `SELECT ${orderAccessOrderColumns} FROM public.orders o WHERE o.id=$1::uuid AND o.cart_id=$2::uuid FOR UPDATE OF o`,
      [orderId, cartId],
    ),
  );
}
export function requirePaidOrder(order: DraftRow) {
  if (
    !(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as unknown[]).includes(
      order["payment_status"],
    ) ||
    !(["OPEN", "CLOSED"] as unknown[]).includes(order["order_status"])
  )
    return rejectOrderAccess("PAYMENT_NOT_CONFIRMED");
}
export async function activeAccessToken(
  client: TransactionClient,
  orderId: unknown,
  candidates: OrderAccessCandidates,
) {
  const token = oneAccessRow(
    await draftRows(
      client,
      `SELECT token.id,token.status,token.created_at>clock_timestamp() future,token.expires_at<=clock_timestamp() expired FROM public.order_access_tokens token WHERE token.order_id=$1::uuid AND token.purpose='LINK' AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS candidate(digest text,version text) WHERE token.token_digest=decode(candidate.digest,'hex') AND token.token_pepper_version=candidate.version) ORDER BY token.id FOR UPDATE OF token`,
      [orderId, candidateBindings(candidates)],
    ),
  );
  if (
    token["status"] !== "ACTIVE" ||
    token["expired"] !== false ||
    token["future"] !== false
  )
    return rejectOrderAccess("ACCESS_DENIED");
  return token;
}
export async function activeAccessSession(
  client: TransactionClient,
  orderId: unknown,
  publicOrderId: string,
  candidates: OrderAccessCandidates,
) {
  const session = oneAccessRow(
    await draftRows(
      client,
      `SELECT session.id,session.exchanged_token_id,session.status,session.created_at>clock_timestamp() future,session.expires_at<=clock_timestamp() expired FROM public.order_access_sessions session WHERE session.order_id=$1::uuid AND session.public_order_id=$2::uuid AND EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS candidate(digest text,version text) WHERE session.session_token_digest=decode(candidate.digest,'hex') AND session.token_pepper_version=candidate.version) ORDER BY session.id FOR UPDATE OF session`,
      [orderId, publicOrderId, candidateBindings(candidates)],
    ),
  );
  if (
    session["status"] !== "ACTIVE" ||
    session["expired"] !== false ||
    session["future"] !== false
  )
    return rejectOrderAccess("ACCESS_DENIED");
  return session;
}

/** Called after aggregate locks and again before commit; a pre-lock timestamp is not authority. */
export async function confirmBootstrapCart(
  client: TransactionClient,
  cartId: string,
) {
  const [row] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now) SELECT c.status='CONVERTED' AND c.created_at<=instant.now AND c.expires_at>instant.now current_access_valid FROM public.carts c CROSS JOIN instant WHERE c.id=$1::uuid`,
    [cartId],
  );
  if (row?.["current_access_valid"] !== true)
    return rejectOrderAccess("ACCESS_DENIED");
}
