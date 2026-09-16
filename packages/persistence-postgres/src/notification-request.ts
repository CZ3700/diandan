import { randomUUID } from "node:crypto";
import {
  notificationRequestResultSchema,
  orderNotificationBaseVariablesSchema,
  persistencePortCommandSchema,
  type NotificationRequestCommand,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  lockNotificationOrder,
  notificationClock,
  notificationIgnored,
  notificationSource,
  rejectNotification,
} from "./notification-data.js";
import type { TransactionClient } from "./transaction-runner.js";

async function variables(
  client: TransactionClient,
  source: DraftRow,
  siteName: string,
) {
  const [row] = await draftRows(
    client,
    `SELECT public.notification_order_snapshot($1::uuid,$2) base_variables`,
    [source["order_id"], siteName],
  );
  return orderNotificationBaseVariablesSchema.parse(row?.["base_variables"]);
}

export async function requestNotification(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: NotificationRequestCommand,
) {
  const original = await notificationSource(client, command.outboxEventId);
  if (!original) return notificationIgnored;
  await lockNotificationOrder(client, original);
  const source = await notificationSource(client, command.outboxEventId);
  if (!source) return notificationIgnored;
  const [prior] = await draftRows(
    client,
    `SELECT id,fallback_used FROM public.notification_deliveries WHERE order_id=$1::uuid AND event_type=$2`,
    [source["order_id"], source["event_type"]],
  );
  if (prior)
    return notificationRequestResultSchema.parse({
      schemaVersion: 1,
      decision: "REPLAY",
      notificationId: prior["id"],
      fallbackUsed: prior["fallback_used"],
    });
  if (
    command.selection.eventType !== source["event_type"] ||
    command.selection.requestedLocale !== source["presentation_locale"]
  )
    return rejectNotification("INVALID_COMMAND");
  const frozen = await variables(client, source, command.siteName);
  const now = await notificationClock(client);
  const selection = command.selection;
  const idempotencyKey = `notification:${command.notificationId}`;
  await client.query(
    `INSERT INTO public.notification_deliveries(id,order_id,customer_contact_id,event_type,requested_locale,resolved_locale,fallback_used,template_key,template_version,idempotency_key,request_id,correlation_id,status,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,'REQUESTED',$13::timestamptz,$13::timestamptz)`,
    [
      command.notificationId,
      source["order_id"],
      source["customer_contact_id"],
      source["event_type"],
      selection.requestedLocale,
      selection.resolvedLocale,
      selection.fallbackUsed,
      selection.templateKey,
      selection.templateVersion,
      idempotencyKey,
      source["request_id"],
      source["correlation_id"],
      now,
    ],
  );
  const runtimeRows = await draftRows(
    client,
    `INSERT INTO public.notification_runtime_state(notification_delivery_id,source_outbox_event_id,event_rank,base_variables,public_storefront_origin,transport_key,contact_lookup_hmac,contact_lookup_key_version,link_nonce,link_pepper_version,link_ttl_seconds,dedupe_until,fallback_reason_code,created_at,updated_at) SELECT $1::uuid,$2::uuid,$3,$4::jsonb,$5,$6,c.email_lookup_hmac,c.lookup_key_version,decode($7,'hex'),$8,$9,$10::timestamptz+($11::integer*interval '1 second'),$12,$10::timestamptz,$10::timestamptz FROM public.customer_contacts c WHERE c.id=$13::uuid AND c.retention_status='ACTIVE' FOR SHARE OF c RETURNING notification_delivery_id`,
    [
      command.notificationId,
      command.outboxEventId,
      source["event_rank"],
      JSON.stringify(frozen),
      command.publicStorefrontOrigin,
      command.transportKey,
      command.linkNonce,
      command.linkPepperVersion,
      command.linkTtlSeconds,
      now,
      command.idempotencyRetentionSeconds,
      selection.fallbackReasonCode ?? null,
      source["customer_contact_id"],
    ],
  );
  if (runtimeRows.length !== 1)
    return rejectNotification("CONTACT_UNAVAILABLE");
  const eventId = randomUUID();
  const append = persistencePortCommandSchema.parse({
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId,
      eventType: "NOTIFICATION_REQUESTED",
      aggregateId: command.notificationId,
      requestId: source["request_id"],
      correlationId: source["correlation_id"],
      occurredAt: now,
      payload: {
        notificationDeliveryId: command.notificationId,
        orderId: source["order_id"],
      },
    },
    aggregateVersion: 1,
    primarySubjectId: command.notificationId,
    secondarySubjectId: source["order_id"],
    market: source["market"],
    currency: source["currency"],
    idempotencyKey,
    availableAt: now,
  });
  if (append.operation !== "APPEND_OUTBOX_EVENT")
    return rejectNotification("INTEGRITY_VIOLATION");
  const response = await outbox.append(append);
  if (
    response.outcome !== "SUCCESS" ||
    response.operation !== "APPEND_OUTBOX_EVENT" ||
    response.value.eventId !== eventId
  )
    return rejectNotification("INTEGRITY_VIOLATION");
  return notificationRequestResultSchema.parse({
    schemaVersion: 1,
    decision: "CREATED",
    notificationId: command.notificationId,
    fallbackUsed: selection.fallbackUsed,
  });
}
