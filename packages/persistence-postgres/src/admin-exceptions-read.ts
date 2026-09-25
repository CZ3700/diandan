import {
  adminExceptionItemSchema,
  type AdminExceptionItem,
  type AdminExceptionTarget,
} from "@fan-support/contracts";
import { readAdminOrderNotification } from "./admin-notification-resend-read.js";
import {
  draftRows,
  adminOrdersTimestamp,
  type DraftRow,
  type TransactionClient,
} from "./admin-exceptions-data.js";
import type { ExceptionAuthority } from "./admin-exceptions-authorization.js";

const sources = `
SELECT 'WEBHOOK'::text kind,i.id,NULL::text consumer_key,a.order_id,
 CASE WHEN EXISTS(SELECT 1 FROM admin_finance_application_receipts r WHERE r.provider_event_id=e.id AND r.decision='REVIEW') OR EXISTS(SELECT 1 FROM order_payment_application_receipts r WHERE r.provider_event_id=e.id AND r.decision='REVIEW') THEN 'REVIEW'
 WHEN EXISTS(SELECT 1 FROM webhook_processing_attempts p WHERE p.webhook_inbox_id=i.id AND p.outcome='SUCCEEDED') THEN 'SUCCEEDED'
 WHEN latest.outcome IS NOT NULL THEN 'FAILED' ELSE 'PENDING' END status,
 coalesce(latest.attempt_number,0)::bigint attempt_count,coalesce(latest.finished_at,i.received_at) updated_at
 FROM webhook_inbox i JOIN provider_events e ON e.webhook_inbox_id=i.id
 LEFT JOIN LATERAL(SELECT p.attempt_number,p.outcome,p.finished_at FROM webhook_processing_attempts p WHERE p.webhook_inbox_id=i.id ORDER BY p.attempt_number DESC LIMIT 1) latest ON true
 LEFT JOIN LATERAL(SELECT payment_attempt_id FROM provider_event_associations s WHERE s.provider_event_id=e.id AND s.association_status='MATCHED' LIMIT 1) association ON true
 LEFT JOIN payment_attempts a ON a.id=association.payment_attempt_id
UNION ALL
SELECT 'DEAD_LETTER',e.id,consumers.consumer_key,CASE WHEN e.event_type='ORDER_PAYMENT_CONFIRMED' THEN e.primary_subject_id WHEN e.event_type IN('FULFILLMENT_STATUS_CHANGED','NOTIFICATION_REQUESTED') THEN e.secondary_subject_id WHEN e.event_type='PAYMENT_STATUS_CHANGED' THEN (SELECT order_id FROM payment_attempts WHERE id=e.primary_subject_id) WHEN e.event_type='REFUND_STATUS_CHANGED' THEN (SELECT order_id FROM refunds WHERE id=e.primary_subject_id) WHEN e.event_type='DISPUTE_STATUS_CHANGED' THEN (SELECT order_id FROM disputes WHERE id=e.primary_subject_id) ELSE NULL END,
 CASE WHEN EXISTS(SELECT 1 FROM outbox_dispatch_attempts p WHERE p.outbox_event_id=e.id AND p.consumer_key=consumers.consumer_key AND p.outcome='SUCCEEDED') THEN 'SUCCEEDED' ELSE 'FAILED' END,
 latest.attempt_number::bigint,latest.finished_at
 FROM outbox_events e JOIN(SELECT DISTINCT outbox_event_id,consumer_key FROM outbox_dispatch_attempts WHERE outcome='DEAD_LETTER') consumers ON consumers.outbox_event_id=e.id
 JOIN LATERAL(SELECT attempt_number,finished_at FROM outbox_dispatch_attempts p WHERE p.outbox_event_id=e.id AND p.consumer_key=consumers.consumer_key ORDER BY attempt_number DESC LIMIT 1) latest ON true
UNION ALL
SELECT 'PAYMENT',a.id,NULL,a.order_id,CASE WHEN a.status='SUCCEEDED' THEN 'SUCCEEDED' WHEN a.status='UNKNOWN' THEN 'UNKNOWN' WHEN a.status IN('FAILED','CANCELED','EXPIRED') THEN 'EXPIRED' ELSE 'PENDING' END,
 coalesce((SELECT max(generation) FROM payment_runtime_operations x WHERE x.attempt_id=a.id),0),a.updated_at FROM payment_attempts a
UNION ALL
SELECT 'NOTIFICATION',d.id,NULL,d.order_id,CASE WHEN d.status='SENT' THEN 'SUCCEEDED' WHEN EXISTS(SELECT 1 FROM notification_delivery_attempts x WHERE x.notification_delivery_id=d.id AND x.outcome='UNKNOWN') THEN 'UNKNOWN' WHEN d.status IN('FAILED','CANCELED') THEN 'FAILED' WHEN d.status='PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,d.attempt_count::bigint,d.updated_at FROM notification_deliveries d
UNION ALL
SELECT 'NOTIFICATION',d.id,NULL,d.order_id,CASE WHEN d.status='SENT' THEN 'SUCCEEDED' WHEN EXISTS(SELECT 1 FROM admin_notification_resend_attempts x WHERE x.resend_id=d.id AND x.outcome='UNKNOWN') THEN 'UNKNOWN' WHEN d.status IN('FAILED','CANCELED') THEN 'FAILED' WHEN d.status='PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,d.attempt_count::bigint,d.updated_at FROM admin_notification_resends d`;
const projection = `WITH sources AS(${sources}) SELECT s.*,o.id canonical_order_id,o.public_order_id,o.version order_version,public.admin_exception_source_version(s.kind,s.id,s.consumer_key) source_version,${adminOrdersTimestamp("s.updated_at")} updated FROM sources s LEFT JOIN orders o ON o.id=s.order_id`;
export async function exceptionQueueState(
  client: TransactionClient,
  target: AdminExceptionTarget,
) {
  if (target.kind !== "WEBHOOK" && target.kind !== "DEAD_LETTER")
    return { busy: false, completed: false };
  const [present] = await draftRows(
    client,
    "SELECT to_regclass('pgboss.job') IS NOT NULL present",
  );
  if (present?.["present"] !== true) return { busy: false, completed: false };
  const [r] = await draftRows(
    client,
    `SELECT coalesce(bool_or(state::text IN('created','retry','active')),false) busy,coalesce(bool_or(state::text='completed'),false) completed FROM pgboss.job WHERE name=$1 AND data->>$2=$3 AND ($4::text IS NULL OR data->>'consumerKey'=$4)`,
    [
      target.kind === "WEBHOOK"
        ? "payment-webhook-inbox-v1"
        : "outbox-dispatch-v1",
      target.kind === "WEBHOOK" ? "webhookInboxId" : "outboxEventId",
      target.id,
      target.consumerKey,
    ],
  );
  return { busy: r?.["busy"] === true, completed: r?.["completed"] === true };
}
export async function exceptionSource(
  client: TransactionClient,
  target: AdminExceptionTarget,
) {
  const [row] = await draftRows(
    client,
    `${projection} WHERE s.kind=$1 AND s.id=$2 AND s.consumer_key IS NOT DISTINCT FROM $3`,
    [target.kind, target.id, target.consumerKey],
  );
  return row;
}
export async function exceptionItem(
  client: TransactionClient,
  row: DraftRow,
  auth: ExceptionAuthority,
): Promise<AdminExceptionItem> {
  const target = {
    kind: row["kind"],
    id: row["id"],
    consumerKey: row["consumer_key"],
  } as AdminExceptionTarget;
  let status = row["status"] as AdminExceptionItem["status"],
    blocked: AdminExceptionItem["blockedReason"] = "NONE";
  const [pending] = await draftRows(
    client,
    `SELECT status FROM admin_exception_operations WHERE status IN('REQUESTED','PROCESSING') AND ((webhook_inbox_id=$1 AND $2='WEBHOOK') OR(outbox_event_id=$1 AND $2='DEAD_LETTER' AND consumer_key=$3)) LIMIT 1`,
    [target.id, target.kind, target.consumerKey],
  );
  const queue = await exceptionQueueState(client, target);
  const permission = {
    WEBHOOK: auth.permissions.canReplayWebhook,
    DEAD_LETTER: auth.permissions.canRetryDeadLetter,
    PAYMENT: auth.permissions.canReconcilePayment,
    NOTIFICATION: auth.permissions.canRetryNotification,
  }[target.kind];
  if (status === "SUCCEEDED") blocked = "ALREADY_COMPLETE";
  else if (status === "REVIEW") blocked = "MANUAL_REVIEW_REQUIRED";
  else if (pending || queue.busy) {
    status = "PROCESSING";
    blocked = "IN_PROGRESS";
  } else if (queue.completed) blocked = "SOURCE_INCONSISTENT";
  else if (
    target.kind === "DEAD_LETTER" &&
    target.consumerKey !== "order-notifications-v1"
  )
    blocked = "UNSUPPORTED_CONSUMER";
  else if (target.kind === "PAYMENT") {
    const [a] = await draftRows(
      client,
      `SELECT a.status,EXISTS(SELECT 1 FROM admin_finance_operations x WHERE x.attempt_id=a.id AND x.phase<>'COMPLETE') busy FROM payment_attempts a WHERE a.id=$1`,
      [target.id],
    );
    if (a?.["busy"] === true) {
      status = "PROCESSING";
      blocked = "IN_PROGRESS";
    } else if (a?.["status"] !== "UNKNOWN") blocked = "NOT_RETRYABLE";
  } else if (target.kind === "NOTIFICATION") {
    if (status === "UNKNOWN") blocked = "NOTIFICATION_UNCERTAIN";
    else if (status !== "FAILED") blocked = "IN_PROGRESS";
    else if (typeof row["canonical_order_id"] === "string") {
      const summary = await readAdminOrderNotification(
        client,
        row["canonical_order_id"],
      );
      if (summary.latestNotificationId !== target.id)
        blocked = "NOTIFICATION_SUPERSEDED";
      else if (summary.status === "UNKNOWN") blocked = "NOTIFICATION_UNCERTAIN";
      else if (!summary.canResend)
        blocked = ["REQUESTED", "PROCESSING", "RETRY_SCHEDULED"].includes(
          summary.status,
        )
          ? "IN_PROGRESS"
          : "NOT_RETRYABLE";
    } else blocked = "SOURCE_INCONSISTENT";
  }
  if (blocked === "NONE" && !permission) blocked = "READ_ONLY";
  const action = {
    WEBHOOK: "REPLAY_WEBHOOK",
    DEAD_LETTER: "RETRY_DEAD_LETTER",
    PAYMENT: "RECONCILE_PAYMENT",
    NOTIFICATION: "RETRY_NOTIFICATION",
  }[target.kind];
  return adminExceptionItemSchema.parse({
    target,
    version: row["source_version"],
    orderId: row["canonical_order_id"] ?? null,
    publicOrderId: row["public_order_id"] ?? null,
    status,
    attemptCount: Number(row["attempt_count"]),
    updatedAt: row["updated"],
    allowedAction: blocked === "NONE" ? action : null,
    blockedReason: blocked,
  });
}
export async function listExceptions(
  client: TransactionClient,
  command: { category: string; status: string; page: number; pageSize: number },
  auth: ExceptionAuthority,
) {
  // Terminal successor dispatches supersede definite failures. Uncertain
  // evidence remains visible even if a later notification exists.
  const supersededFailure = `EXISTS(
    SELECT 1 FROM notification_deliveries base
    WHERE (base.id=s.id OR EXISTS(SELECT 1 FROM admin_notification_resends original WHERE original.id=s.id AND original.base_notification_id=base.id))
    AND (
      EXISTS(SELECT 1 FROM admin_notification_resends successor WHERE successor.base_notification_id=base.id
        AND successor.resend_sequence>coalesce((SELECT original.resend_sequence FROM admin_notification_resends original WHERE original.id=s.id),0)
        AND successor.status IN('SENT','FAILED','CANCELED'))
      OR EXISTS(SELECT 1 FROM notification_deliveries successor WHERE successor.order_id=base.order_id
        AND successor.event_type=admin_notification_current_event(base.order_id) AND successor.event_type<>base.event_type
        AND successor.status IN('SENT','FAILED','CANCELED'))
    ))`;
  const filter = `WHERE ($1='ALL' OR s.kind=$1)
    AND (s.kind<>'PAYMENT' OR s.status='UNKNOWN' OR EXISTS(SELECT 1 FROM admin_exception_receipts r WHERE r.target_kind='PAYMENT' AND r.target_id=s.id))
    AND ($2='ALL' OR s.status<>'SUCCEEDED')
    AND(s.kind<>'NOTIFICATION' OR $2='ALL' OR s.status IN('FAILED','UNKNOWN') OR EXISTS(SELECT 1 FROM admin_exception_receipts r WHERE r.target_kind='NOTIFICATION' AND r.target_id=s.id))
    AND(s.kind<>'NOTIFICATION' OR $2='ALL' OR s.status<>'FAILED' OR NOT ${supersededFailure})`;

  const [count] = await draftRows(
    client,
    `WITH sources AS(${sources}) SELECT count(*) total FROM sources s ${filter}`,
    [command.category, command.status],
  );
  const rows = await draftRows(
    client,
    `${projection} ${filter} ORDER BY s.updated_at DESC,s.kind,s.id,s.consumer_key LIMIT $3 OFFSET $4`,
    [
      command.category,
      command.status,
      command.pageSize,
      (command.page - 1) * command.pageSize,
    ],
  );
  const items = [];
  for (const row of rows) items.push(await exceptionItem(client, row, auth));
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "LIST" as const,
    page: command.page,
    pageSize: command.pageSize,
    totalItems: Number(count?.["total"]),
    items,
  };
}
export async function exceptionOperations(
  client: TransactionClient,
  target: AdminExceptionTarget,
) {
  const rows = await draftRows(
    client,
    `SELECT coalesce(r.operation_id,r.finance_operation_id,r.notification_resend_id) operation_id,r.action,coalesce(x.status,CASE WHEN f.id IS NOT NULL THEN CASE WHEN f.phase='COMPLETE' THEN 'SUCCEEDED' ELSE 'PROCESSING' END END,CASE WHEN n.status='SENT' THEN 'SUCCEEDED' WHEN n.status IN('FAILED','CANCELED') THEN 'FAILED' WHEN n.status='REQUESTED' THEN 'REQUESTED' ELSE 'PROCESSING' END) status,${adminOrdersTimestamp("r.created_at")} created_at FROM admin_exception_receipts r LEFT JOIN admin_exception_operations x ON x.id=r.operation_id LEFT JOIN admin_finance_operations f ON f.id=r.finance_operation_id LEFT JOIN admin_notification_resends n ON n.id=r.notification_resend_id WHERE r.target_kind=$1 AND r.target_id=$2 AND r.consumer_key IS NOT DISTINCT FROM $3 ORDER BY r.created_at DESC,r.id DESC LIMIT 20`,
    [target.kind, target.id, target.consumerKey],
  );
  return rows.map((r) => ({
    operationId: r["operation_id"],
    action: r["action"],
    status: r["status"],
    createdAt: r["created_at"],
  }));
}
