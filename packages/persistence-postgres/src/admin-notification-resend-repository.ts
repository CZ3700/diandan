import { randomBytes, randomUUID } from "node:crypto";
import {
  adminOrdersStoreRequestSchema,
  adminOrdersMutationResponseSchema,
  type AdminOrdersFailure,
} from "@fan-support/contracts";
import type { AdminOrderResendRepository } from "@fan-support/persistence-port";
import {
  authorizeAdminOrders,
  confirmAdminOrdersAuthority,
} from "./admin-orders-authorization.js";
import { draftRows } from "./content-draft-data.js";
import {
  lockNotificationOrder,
  notificationClock,
} from "./notification-data.js";
import { readAdminOrderNotification } from "./admin-notification-resend-read.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
const failure = (code: AdminOrdersFailure["code"]): AdminOrdersFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

/** Authorizes and queues one new dispatch; never resets an existing delivery. */
export function createAdminOrderResendRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminOrderResendRepository {
  return {
    request: (input) =>
      scope.trackOperation(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        if (
          !parsed.success ||
          parsed.data.command.action !== "RESEND_NOTIFICATION"
        )
          return failure("INVALID_COMMAND");
        const request = parsed.data,
          command = parsed.data.command;
        try {
          const auth = await authorizeAdminOrders(client, request.access, {
            permission: "orders.notification.resend",
          });
          if (auth.outcome === "FAILURE") return auth;
          if (!auth.principal.permissions.includes("orders.read"))
            return failure("FORBIDDEN");
          // Serialize one actor/action/key even when concurrent requests name different orders.
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [
              `admin-orders:${auth.principal.actorId}:${command.action}:${command.idempotencyKey}`,
            ],
          );
          const [owner] = await draftRows(
            client,
            "SELECT id order_id,cart_id FROM public.orders WHERE id=$1::uuid",
            [command.orderId],
          );
          if (!owner) return failure("NOT_FOUND");
          await lockNotificationOrder(client, owner);
          const revoked = await confirmAdminOrdersAuthority(
            client,
            auth.principal,
          );
          if (revoked) return revoked;
          const [prior] = await draftRows(
            client,
            "SELECT id,order_id,request_hash FROM public.admin_notification_resends WHERE actor_id=$1::uuid AND command_idempotency_key=$2",
            [auth.principal.actorId, command.idempotencyKey],
          );
          if (prior)
            return prior["request_hash"] === request.requestHash &&
              prior["order_id"] === command.orderId
              ? adminOrdersMutationResponseSchema.parse({
                  schemaVersion: 1,
                  outcome: "SUCCESS",
                  kind: "MUTATION",
                  orderId: command.orderId,
                  resultId: prior["id"],
                  replayed: true,
                })
              : failure("IDEMPOTENCY_CONFLICT");
          const [order] = await draftRows(
            client,
            "SELECT version FROM public.orders WHERE id=$1::uuid",
            [command.orderId],
          );
          if (Number(order?.["version"]) !== command.expectedOrderVersion)
            return failure("STALE_VERSION");
          const summary = await readAdminOrderNotification(
            client,
            command.orderId,
          );
          if (
            summary.latestNotificationId !==
            command.expectedLatestNotificationId
          )
            return failure("STALE_VERSION");
          if (!summary.canResend)
            return failure(
              [
                "REQUESTED",
                "PROCESSING",
                "RETRY_SCHEDULED",
                "UNKNOWN",
              ].includes(summary.status)
                ? "NOTIFICATION_IN_PROGRESS"
                : "NOTIFICATION_NOT_READY",
            );
          const now = await notificationClock(client),
            id = randomUUID(),
            auditId = randomUUID();
          await client.query(
            `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
        VALUES($1::uuid,'ADMIN',$2::uuid,'RESEND_ORDER_NOTIFICATION','ORDER',$3::uuid,$4,$5::uuid,$6::uuid,'SUCCEEDED',$7::timestamptz)`,
            [
              auditId,
              auth.principal.actorId,
              command.orderId,
              command.reasonCode,
              request.access.requestId,
              request.access.correlationId,
              now,
            ],
          );
          const rows = await draftRows(
            client,
            `INSERT INTO public.admin_notification_resends(
        id,order_id,customer_contact_id,base_notification_id,source_outbox_event_id,order_version,resend_sequence,event_type,event_rank,
        requested_locale,resolved_locale,fallback_used,fallback_reason_code,template_key,template_version,base_variables,public_storefront_origin,transport_key,
        contact_lookup_hmac,contact_lookup_key_version,link_nonce,link_pepper_version,link_ttl_seconds,dedupe_until,
        actor_id,session_id,command_idempotency_key,request_hash,reason_code,audit_log_id,idempotency_key,request_id,correlation_id,status,created_at,updated_at)
        SELECT $1::uuid,d.order_id,d.customer_contact_id,d.id,r.source_outbox_event_id,$2,
          (SELECT coalesce(max(resend_sequence),0)+1 FROM public.admin_notification_resends WHERE order_id=d.order_id),d.event_type,r.event_rank,
          d.requested_locale,d.resolved_locale,d.fallback_used,r.fallback_reason_code,d.template_key,d.template_version,r.base_variables,r.public_storefront_origin,r.transport_key,
          r.contact_lookup_hmac,r.contact_lookup_key_version,decode($3,'hex'),r.link_pepper_version,r.link_ttl_seconds,$4::timestamptz+(r.dedupe_until-r.created_at),
          $5::uuid,$6::uuid,$7,$8,$9,$10::uuid,$11,$12::uuid,$13::uuid,'REQUESTED',$4::timestamptz,$4::timestamptz
        FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id
        WHERE d.order_id=$14::uuid AND d.event_type=public.admin_notification_current_event(d.order_id) RETURNING id`,
            [
              id,
              command.expectedOrderVersion,
              randomBytes(32).toString("hex"),
              now,
              auth.principal.actorId,
              auth.principal.sessionId,
              command.idempotencyKey,
              request.requestHash,
              command.reasonCode,
              auditId,
              `admin-resend:${id}`,
              request.access.requestId,
              request.access.correlationId,
              command.orderId,
            ],
          );
          if (rows.length !== 1)
            throw new Error("Resend insertion did not preserve current source");
          await client.query(
            "INSERT INTO public.admin_notification_resend_outbox(resend_id,created_at) VALUES($1::uuid,$2::timestamptz)",
            [id, now],
          );
          return adminOrdersMutationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "MUTATION",
            orderId: command.orderId,
            resultId: id,
            replayed: false,
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
