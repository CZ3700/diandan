import { randomUUID } from "node:crypto";
import type {
  CommerceExpiryCommand,
  CommerceExpiryResult,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { insertPaymentRow } from "./payment-runtime-history.js";
import {
  createPersistenceTransactionFailureError,
  type TransactionClient,
} from "./transaction-runner.js";

export function rejectExpiry(
  code: "INVALID_COMMAND" | "INTEGRITY_VIOLATION",
): never {
  throw createPersistenceTransactionFailureError({ code, recovery: "NONE" });
}
export const expiryResult = (
  decision: CommerceExpiryResult["decision"],
): CommerceExpiryResult => ({
  schemaVersion: 1,
  decision,
  expiredReservations: 0,
  expiredIntents: 0,
  expiredCart: false,
  expiredTokens: 0,
  expiredSessions: 0,
  canceledOrders: 0,
  canceledIntents: 0,
  expiredCheckoutSessions: 0,
});
export async function auditExpiry(
  client: TransactionClient,
  command: CommerceExpiryCommand,
  subjectType: string,
  subjectId: unknown,
  action: string,
  reasonCode: string,
  at: string,
) {
  const id = randomUUID();
  await insertPaymentRow(client, "audit_logs", {
    id,
    actor_type: "SYSTEM",
    task_name: command.taskName,
    action,
    subject_type: subjectType,
    subject_id: subjectId,
    reason_code: reasonCode,
    request_id: command.requestId,
    correlation_id: command.correlationId,
    outcome: "SUCCEEDED",
    created_at: at,
  });
  return id;
}
export async function expireAccess(
  client: TransactionClient,
  command: CommerceExpiryCommand,
  orderId: unknown,
  at: string,
  result: CommerceExpiryResult,
) {
  for (const kind of ["tokens", "sessions"] as const) {
    const rows = await draftRows(
      client,
      `UPDATE public.order_access_${kind} SET status='EXPIRED',version=version+1,expired_at=$2::timestamptz WHERE order_id=$1::uuid AND status='ACTIVE' AND expires_at<=$2::timestamptz AND expires_at<=clock_timestamp() RETURNING id`,
      [orderId, at],
    );
    for (const row of rows)
      await auditExpiry(
        client,
        command,
        kind === "tokens" ? "ORDER_ACCESS_TOKEN" : "ORDER_ACCESS_SESSION",
        row["id"],
        "ORDER_ACCESS_EXPIRED",
        "ACCESS_LIFETIME_ELAPSED",
        at,
      );
    if (kind === "tokens") result.expiredTokens += rows.length;
    else result.expiredSessions += rows.length;
  }
}

export async function cancelExpiredCheckout(
  client: TransactionClient,
  command: CommerceExpiryCommand,
  order: DraftRow,
  at: string,
  result: CommerceExpiryResult,
) {
  const intents = await draftRows(
    client,
    `UPDATE public.support_intents SET status='CANCELED',version=version+1,updated_at=$2::timestamptz WHERE id IN(SELECT support_intent_id FROM public.order_items WHERE order_id=$1::uuid) AND status='CHECKOUT_LOCKED' RETURNING id`,
    [order["id"], at],
  );
  result.canceledIntents = intents.length;
  const sessions = await draftRows(
    client,
    `UPDATE public.checkout_sessions SET status='EXPIRED',updated_at=$2::timestamptz WHERE id=$1::uuid AND status IN('CREATED','READY','PAYMENT_PENDING') AND quote_expires_at<=$2::timestamptz RETURNING id`,
    [order["checkout_session_id"], at],
  );
  if (sessions.length !== 1) rejectExpiry("INTEGRITY_VIOLATION");
  result.expiredCheckoutSessions = sessions.length;
  const carts = await draftRows(
    client,
    `UPDATE public.carts SET status='EXPIRED',version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid AND status='LOCKED' AND locked_order_id=$3::uuid RETURNING id`,
    [command.cartId, at, order["id"]],
  );
  if (carts.length !== 1) rejectExpiry("INTEGRITY_VIOLATION");
  result.expiredCart = true;
  const auditId = await auditExpiry(
    client,
    command,
    "ORDER",
    order["id"],
    "ORDER_CHECKOUT_EXPIRED",
    "CHECKOUT_QUOTE_EXPIRED",
    at,
  );
  const changed = await draftRows(
    client,
    `UPDATE public.orders SET order_status='CANCELED',version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid AND order_status='PENDING_PAYMENT' AND version=$3::bigint AND quote_expires_at<=$2::timestamptz AND quote_expires_at<=clock_timestamp() RETURNING id`,
    [order["id"], at, order["version"]],
  );
  if (changed.length !== 1) rejectExpiry("INTEGRITY_VIOLATION");
  await insertPaymentRow(client, "order_events", {
    id: randomUUID(),
    order_id: order["id"],
    sequence: Number(order["version"]) + 1,
    event_type: "LIFECYCLE_CHANGED",
    from_order_status: order["order_status"],
    to_order_status: "CANCELED",
    from_payment_status: order["payment_status"],
    to_payment_status: order["payment_status"],
    from_dispute_status: order["dispute_status"],
    to_dispute_status: order["dispute_status"],
    from_fulfillment_status: order["fulfillment_status"],
    to_fulfillment_status: order["fulfillment_status"],
    from_payment_attempt_id: order["current_payment_attempt_id"],
    to_payment_attempt_id: order["current_payment_attempt_id"],
    authority_kind: "SYSTEM",
    reason_code: "CHECKOUT_QUOTE_EXPIRED",
    audit_log_id: auditId,
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: at,
  });
  result.canceledOrders = 1;
}
