import { randomUUID } from "node:crypto";
import {
  type AdminOrdersFailure,
  type AdminOrdersPrincipal,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  createPersistenceTransactionFailureError,
  type TransactionClient,
} from "./transaction-runner.js";
export const adminOrdersFailure = (
  code: AdminOrdersFailure["code"],
): AdminOrdersFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const adminOrdersTimestamp = (expression: string) =>
  `to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export function rejectAdminOrdersIntegrity(): never {
  throw createPersistenceTransactionFailureError({
    code: "INTEGRITY_VIOLATION",
    recovery: "NONE",
  });
}
export const adminOrdersEncrypted = (value: unknown) =>
  Buffer.isBuffer(value) && value.length > 0
    ? `enc:v1:${value.toString("base64url")}`
    : rejectAdminOrdersIntegrity();
export const adminOrdersBytes = (value: string) =>
  Buffer.from(value.slice("enc:v1:".length), "base64url");
export async function lockAdminOrder(
  client: TransactionClient,
  orderId: string,
): Promise<DraftRow | undefined> {
  const [initial] = await draftRows(
    client,
    "SELECT cart_id FROM public.orders WHERE id=$1::uuid",
    [orderId],
  );
  if (!initial) return undefined;
  await draftRows(
    client,
    "SELECT id FROM public.carts WHERE id=$1::uuid FOR UPDATE",
    [initial["cart_id"]],
  );
  const [order] = await draftRows(
    client,
    `SELECT o.*,${adminOrdersTimestamp("o.created_at")} created_at,${adminOrdersTimestamp("o.updated_at")} updated_at,updated_at<=transaction_timestamp() writable_at_transaction FROM public.orders o WHERE o.id=$1::uuid FOR UPDATE`,
    [orderId],
  );
  if (!order) return undefined;
  // Read after the order lock: a refund accepted while we waited must pause
  // fulfillment in this transaction's next READ COMMITTED snapshot.
  const [refund] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.refunds WHERE order_id=$1::uuid
      AND status IN ('REQUESTED','SUBMITTING','PROCESSING','UNKNOWN')) refund_pending`,
    [orderId],
  );
  if (typeof refund?.["refund_pending"] !== "boolean")
    return rejectAdminOrdersIntegrity();
  return { ...order, refund_pending: refund["refund_pending"] };
}
export async function adminOrdersAudit(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
  action: string,
  subjectType: string,
  subjectId: unknown,
  fieldCategory: string | null = null,
) {
  const id = randomUUID(),
    reason =
      "reasonCode" in request.command ? request.command.reasonCode : null;
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$8,'SUCCEEDED',$9)`,
    [
      id,
      principal.actorId,
      action,
      subjectType,
      subjectId,
      reason,
      request.access.requestId,
      request.access.correlationId,
      fieldCategory,
    ],
  );
  return id;
}
export async function readAdminOrderReceipt(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  if (!("idempotencyKey" in request.command)) return null;
  const [row] = await draftRows(
    client,
    `SELECT order_id,result_id,request_hash FROM public.admin_order_operation_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3`,
    [principal.actorId, request.command.action, request.command.idempotencyKey],
  );
  if (!row) return null;
  if (
    row["request_hash"] !== request.requestHash ||
    row["order_id"] !== request.command.orderId
  )
    return adminOrdersFailure("IDEMPOTENCY_CONFLICT");
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "MUTATION" as const,
    orderId: String(row["order_id"]),
    resultId: String(row["result_id"]),
    replayed: true,
  };
}
export async function recordAdminOrderReceipt(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
  resultId: string,
  auditId: string,
) {
  const command = request.command;
  if (!("idempotencyKey" in command)) return rejectAdminOrdersIntegrity();
  await client.query(
    `INSERT INTO public.admin_order_operation_receipts(id,actor_id,session_id,order_id,action,idempotency_key,request_hash,result_id,audit_log_id,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      principal.actorId,
      principal.sessionId,
      command.orderId,
      command.action,
      command.idempotencyKey,
      request.requestHash,
      resultId,
      auditId,
      request.access.requestId,
      request.access.correlationId,
    ],
  );
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "MUTATION" as const,
    orderId: command.orderId,
    resultId,
    replayed: false,
  };
}
export async function readAdminOrderLines(
  client: TransactionClient,
  orderId: string,
  lock = false,
): Promise<DraftRow[]> {
  return draftRows(
    client,
    `SELECT i.id item_id,i.support_intent_id,i.cart_item_id,i.gift_id,i.gift_translation_revision_id,i.gift_daily_translation_id,i.checkout_preflight_id,
 f.id fulfillment_id,f.version fulfillment_version,f.status,f.hold_reason_code,f.prepared_at,f.updated_at fulfillment_updated_at,
 s.version intent_version,s.moderation_status,s.privacy_state,s.fan_message_locale,s.display_mode,s.fan_message_ciphertext,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,
 (c.has_fan_message OR s.fan_message_ciphertext IS NOT NULL) has_message,(s.display_mode='nickname') has_display_name,
 (SELECT e.from_status FROM public.fulfillment_events e JOIN public.admin_order_fulfillment_receipts r ON r.fulfillment_event_id=e.id WHERE e.fulfillment_id=f.id AND e.sequence=f.version AND e.to_status='ON_HOLD' AND e.authority_kind='ADMIN' AND r.action='HOLD') resume_status,
 (SELECT r.review_locale FROM public.admin_order_message_reviews r WHERE r.support_intent_id=s.id AND r.result_intent_version=s.version ORDER BY r.created_at DESC LIMIT 1) reviewed_locale
 FROM public.order_items i JOIN public.fulfillments f ON f.order_item_id=i.id AND f.order_id=i.order_id
 JOIN public.support_intents s ON s.id=i.support_intent_id JOIN public.cart_items c ON c.id=i.cart_item_id
 WHERE i.order_id=$1 ORDER BY i.created_at,i.id ${lock ? "FOR UPDATE OF f,s" : ""}`,
    [orderId],
  );
}
