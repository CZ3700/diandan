import { draftRows, type DraftRow } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import { lockNotificationOrder } from "./notification-data.js";
import type { TransactionClient } from "./transaction-runner.js";
import type { NotificationLeaseCommand } from "@fan-support/contracts";

export async function lockAdminNotificationResend(
  client: TransactionClient,
  id: string,
) {
  const [owner] = await draftRows(
    client,
    "SELECT r.order_id,o.cart_id FROM public.admin_notification_resends r JOIN public.orders o ON o.id=r.order_id WHERE r.id=$1::uuid",
    [id],
  );
  if (!owner) return undefined;
  await lockNotificationOrder(client, owner);
  const [row] = await draftRows(
    client,
    `SELECT r.*,encode(r.link_nonce,'hex') link_nonce,${cartTimestamp("r.created_at")} created_at,${cartTimestamp("r.dedupe_until")} dedupe_until,${cartTimestamp("r.lease_started_at")} lease_started_at,${cartTimestamp("r.lease_expires_at")} lease_expires_at,${cartTimestamp("r.next_attempt_at")} next_attempt_at FROM public.admin_notification_resends r JOIN public.admin_notification_resend_outbox q ON q.resend_id=r.id WHERE r.id=$1::uuid FOR UPDATE OF r`,
    [id],
  );
  return row;
}
export async function currentAdminResendLease(
  client: TransactionClient,
  command: NotificationLeaseCommand,
  requireDedupe = true,
) {
  const [row] = await draftRows(
    client,
    `SELECT lease_expires_at>clock_timestamp() AND (NOT $3::boolean OR dedupe_until>clock_timestamp()) valid FROM public.admin_notification_resends WHERE id=$1::uuid AND status='PROCESSING' AND lease_token=$2::uuid`,
    [command.notificationId, command.leaseToken, requireDedupe],
  );
  return row?.["valid"] === true;
}
export async function adminResendIsCurrent(
  client: TransactionClient,
  row: DraftRow,
) {
  const [value] = await draftRows(
    client,
    `SELECT public.admin_notification_current_event($1::uuid)=$2
 AND NOT EXISTS(SELECT 1 FROM public.admin_notification_resends later WHERE later.order_id=$1::uuid AND later.resend_sequence>$3)
 AND NOT EXISTS(SELECT 1 FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id WHERE d.order_id=$1::uuid AND r.event_rank>$4 AND (d.status='SENT' OR r.link_token_id IS NOT NULL)) valid`,
    [
      row["order_id"],
      row["event_type"],
      row["resend_sequence"],
      row["event_rank"],
    ],
  );
  return value?.["valid"] === true;
}
export async function adminResendContact(
  client: TransactionClient,
  row: DraftRow,
) {
  const [contact] = await draftRows(
    client,
    `SELECT c.id,c.retention_status,c.email_ciphertext,c.encrypted_data_key,c.encryption_key_version FROM public.customer_contacts c JOIN public.orders o ON o.customer_contact_id=c.id WHERE c.id=$1::uuid AND o.id=$2::uuid AND c.email_lookup_hmac=decode($3,'hex') AND c.lookup_key_version=$4 FOR SHARE OF c`,
    [
      row["customer_contact_id"],
      row["order_id"],
      Buffer.from(row["contact_lookup_hmac"] as Uint8Array).toString("hex"),
      row["contact_lookup_key_version"],
    ],
  );
  return contact;
}
