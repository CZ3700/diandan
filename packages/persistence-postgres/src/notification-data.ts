import { NotificationRepositoryError } from "@fan-support/persistence-port";
import type { NotificationLeaseCommand } from "@fan-support/contracts";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const rejectNotification = (
  code: NotificationRepositoryError["code"],
): never => {
  throw new NotificationRepositoryError(code);
};
export const notificationSkip = {
  schemaVersion: 1 as const,
  decision: "SKIP" as const,
};
export const notificationFailed = {
  schemaVersion: 1 as const,
  decision: "FAILED" as const,
};
export const notificationIgnored = {
  schemaVersion: 1 as const,
  decision: "IGNORED" as const,
};

export async function notificationSource(
  client: TransactionClient,
  sourceId: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT source.*,o.cart_id,o.customer_contact_id,o.public_order_id,o.presentation_locale,o.market,o.currency,o.total_amount_minor::text,${cartTimestamp("o.created_at")} ordered_at,x.request_id,x.correlation_id FROM public.notification_source_authority($1::uuid) source JOIN public.orders o ON o.id=source.order_id JOIN public.outbox_events x ON x.id=$1::uuid`,
    [sourceId],
  );
  return row;
}

/** All notification mutations follow the same cart -> order -> delivery lock order. */
export async function lockNotification(
  client: TransactionClient,
  notificationId: string,
) {
  const [owner] = await draftRows(
    client,
    `SELECT d.order_id,o.cart_id FROM public.notification_deliveries d JOIN public.orders o ON o.id=d.order_id JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id WHERE d.id=$1::uuid`,
    [notificationId],
  );
  if (!owner) return undefined;
  await lockNotificationOrder(client, owner);
  const [row] = await draftRows(
    client,
    `SELECT d.*,r.source_outbox_event_id,r.event_rank,r.base_variables,r.public_storefront_origin,r.transport_key,encode(r.link_nonce,'hex') link_nonce,r.link_pepper_version,r.link_ttl_seconds,${cartTimestamp("r.dedupe_until")} dedupe_until,r.fallback_reason_code,r.link_token_id,r.content_hash,r.lease_token,r.generation,${cartTimestamp("r.lease_started_at")} lease_started_at,${cartTimestamp("r.lease_expires_at")} lease_expires_at,${cartTimestamp("d.created_at")} created_at,${cartTimestamp("d.next_attempt_at")} next_attempt_at FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id WHERE d.id=$1::uuid FOR UPDATE OF d,r`,
    [notificationId],
  );
  return row;
}
export async function lockNotificationOrder(
  client: TransactionClient,
  row: DraftRow,
) {
  await draftRows(
    client,
    `SELECT id FROM public.carts WHERE id=$1::uuid FOR UPDATE`,
    [row["cart_id"]],
  );
  await draftRows(
    client,
    `SELECT id FROM public.orders WHERE id=$1::uuid FOR UPDATE`,
    [row["order_id"]],
  );
}
export async function notificationClock(client: TransactionClient) {
  const [row] = await draftRows(
    client,
    `SELECT ${cartTimestamp("clock_timestamp()")} now`,
  );
  if (typeof row?.["now"] !== "string")
    return rejectNotification("INTEGRITY_VIOLATION");
  return row["now"];
}
export async function currentNotificationLease(
  client: TransactionClient,
  command: NotificationLeaseCommand,
  requireDedupe = true,
) {
  const [row] = await draftRows(
    client,
    `SELECT r.lease_expires_at>clock_timestamp() AND (NOT $3::boolean OR r.dedupe_until>clock_timestamp()) valid FROM public.notification_runtime_state r JOIN public.notification_deliveries d ON d.id=r.notification_delivery_id WHERE d.id=$1::uuid AND d.status='PROCESSING' AND r.lease_token=$2::uuid`,
    [command.notificationId, command.leaseToken, requireDedupe],
  );
  return row?.["valid"] === true;
}
export async function hasLaterNotification(
  client: TransactionClient,
  row: DraftRow,
) {
  const [value] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id WHERE d.order_id=$1::uuid AND r.event_rank>$2::integer AND (d.status='SENT' OR r.link_token_id IS NOT NULL))
      OR EXISTS(SELECT 1 FROM public.admin_notification_resends r WHERE r.order_id=$1::uuid AND r.event_rank>=$2::integer AND (r.status='SENT' OR r.link_token_id IS NOT NULL)) blocked`,
    [row["order_id"], row["event_rank"]],
  );
  return value?.["blocked"] === true;
}

/** A pending or still-acceptable UNKNOWN send must not arrive after a later stage. */
export async function hasPendingAdminNotificationResend(
  client: TransactionClient,
  orderId: unknown,
  exceptNotificationId?: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.admin_notification_resends manual WHERE manual.order_id=$1::uuid AND
      (manual.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED') OR
       (manual.status<>'SENT' AND NOT public.notification_submission_definite(manual.id) AND manual.dedupe_until>clock_timestamp() AND EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a WHERE a.resend_id=manual.id AND a.outcome='UNKNOWN'))))
       OR public.notification_submission_unresolved($1::uuid,$2::uuid) blocked`,
    [orderId, exceptNotificationId ?? null],
  );
  return row?.["blocked"] === true;
}
