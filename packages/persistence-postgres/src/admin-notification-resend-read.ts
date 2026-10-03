import { adminOrdersNotificationSchema } from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** One current-state summary; neither mail content, contacts nor access credentials. */
export async function readAdminOrderNotification(
  client: TransactionClient,
  orderId: string,
) {
  const [row] = await draftRows(
    client,
    `
    SELECT d.id base_id,coalesce(r.id,d.id) latest_id,d.event_type,coalesce(r.status,d.status) status,
      EXISTS(SELECT 1 FROM public.notification_delivery_attempts a WHERE a.notification_delivery_id=d.id AND a.outcome='UNKNOWN' AND d.status<>'SENT' AND NOT public.notification_submission_definite(d.id))
      OR EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a WHERE a.resend_id=r.id AND a.outcome='UNKNOWN' AND r.status<>'SENT' AND NOT public.notification_submission_definite(r.id)) unknown,
      EXISTS(SELECT 1 FROM public.notification_deliveries pending WHERE pending.order_id=d.order_id AND pending.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED'))
      OR EXISTS(SELECT 1 FROM public.admin_notification_resends pending WHERE pending.order_id=d.order_id AND pending.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED')) busy,
      EXISTS(SELECT 1 FROM public.admin_notification_resends recent WHERE recent.order_id=d.order_id AND recent.created_at>clock_timestamp()-interval '60 seconds') throttled,
      EXISTS(SELECT 1 FROM public.customer_contacts c WHERE c.id=d.customer_contact_id AND c.retention_status='ACTIVE') contact_active,
      EXISTS(SELECT 1 FROM public.notification_delivery_attempts a JOIN public.notification_deliveries uncertain ON uncertain.id=a.notification_delivery_id WHERE uncertain.order_id=d.order_id AND uncertain.status<>'SENT' AND a.outcome='UNKNOWN' AND NOT public.notification_submission_definite(uncertain.id))
      OR EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a JOIN public.admin_notification_resends uncertain ON uncertain.id=a.resend_id WHERE uncertain.order_id=d.order_id AND uncertain.status<>'SENT' AND a.outcome='UNKNOWN' AND NOT public.notification_submission_definite(uncertain.id))
      OR public.notification_submission_unresolved(d.order_id) unresolved,
      public.notification_submission_unresolved(d.order_id) native_unresolved
    FROM public.notification_deliveries d JOIN public.notification_runtime_state runtime ON runtime.notification_delivery_id=d.id
    LEFT JOIN LATERAL(SELECT id,status FROM public.admin_notification_resends resend WHERE resend.base_notification_id=d.id ORDER BY resend.resend_sequence DESC LIMIT 1) r ON true
    WHERE d.order_id=$1::uuid AND d.event_type=public.admin_notification_current_event(d.order_id)`,
    [orderId],
  );
  if (!row)
    return adminOrdersNotificationSchema.parse({
      latestNotificationId: null,
      eventType: null,
      status: "NONE",
      canResend: false,
    });
  let status = row["status"];
  if (status === "CANCELED") status = "FAILED";
  if (row["unknown"] === true || row["native_unresolved"] === true)
    status = "UNKNOWN";
  return adminOrdersNotificationSchema.parse({
    latestNotificationId: row["latest_id"],
    eventType: row["event_type"],
    status,
    canResend:
      ["SENT", "FAILED"].includes(String(status)) &&
      row["busy"] === false &&
      row["throttled"] === false &&
      row["contact_active"] === true &&
      row["unresolved"] === false,
  });
}
