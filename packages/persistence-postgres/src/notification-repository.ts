import {
  notificationSourceCommandSchema,
  notificationSourceResultSchema,
  notificationRequestCommandSchema,
  notificationClaimCommandSchema,
  notificationAttachLinkCommandSchema,
  notificationLeaseCommandSchema,
  notificationConfirmSendCommandSchema,
  notificationFinishCommandSchema,
  notificationListPendingCommandSchema,
  notificationListPendingResultSchema,
} from "@fan-support/contracts";
import {
  NotificationRepositoryError,
  type NotificationRepository,
  type OutboxRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  notificationIgnored,
  notificationSource,
  rejectNotification,
} from "./notification-data.js";
import { requestNotification } from "./notification-request.js";
import {
  claimNotification,
  finishNotification,
} from "./notification-lifecycle.js";
import {
  attachNotificationLink,
  notificationRecipient,
  confirmNotificationSend,
} from "./notification-access.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

type Schema<Value> = {
  safeParse(
    value: unknown,
  ): { success: true; data: Value } | { success: false };
};
export function createNotificationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  outbox: OutboxRepository,
): NotificationRepository {
  const run = <Input, Output>(
    schema: Schema<Input>,
    input: unknown,
    work: (parsed: Input) => Promise<Output>,
  ) =>
    scope.trackOperation(async () => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) return rejectNotification("INVALID_COMMAND");
      try {
        return await work(parsed.data);
      } catch (error) {
        if (error instanceof NotificationRepositoryError) throw error;
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    source: (input) =>
      run(notificationSourceCommandSchema, input, async (command) => {
        const source = await notificationSource(client, command.outboxEventId);
        return source
          ? notificationSourceResultSchema.parse({
              schemaVersion: 1,
              decision: "READY",
              eventType: source["event_type"],
              requestedLocale: source["presentation_locale"],
            })
          : notificationIgnored;
      }),
    request: (input) =>
      run(notificationRequestCommandSchema, input, (command) =>
        requestNotification(client, outbox, command),
      ),
    claim: (input) =>
      run(notificationClaimCommandSchema, input, (command) =>
        claimNotification(client, command),
      ),
    attachLink: (input) =>
      run(notificationAttachLinkCommandSchema, input, (command) =>
        attachNotificationLink(client, command),
      ),
    recipient: (input) =>
      run(notificationLeaseCommandSchema, input, (command) =>
        notificationRecipient(client, command),
      ),
    confirmSend: (input) =>
      run(notificationConfirmSendCommandSchema, input, (command) =>
        confirmNotificationSend(client, command),
      ),
    finish: (input) =>
      run(notificationFinishCommandSchema, input, (command) =>
        finishNotification(client, command),
      ),
    listPending: (input) =>
      run(notificationListPendingCommandSchema, input, async (command) => {
        const rows = await draftRows(
          client,
          `SELECT d.id FROM public.notification_deliveries d JOIN public.notification_runtime_state r ON r.notification_delivery_id=d.id
          WHERE (d.status='FAILED' AND public.notification_submission_recoverable(d.id)) OR ((d.status='REQUESTED' OR (d.status='RETRY_SCHEDULED' AND (d.next_attempt_at<=clock_timestamp() OR r.dedupe_until<=clock_timestamp())) OR (d.status='PROCESSING' AND r.lease_expires_at<=clock_timestamp()))
          AND NOT public.notification_submission_unresolved(d.order_id,d.id)
          AND (d.status='PROCESSING' OR r.dedupe_until<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.admin_notification_resends manual WHERE manual.order_id=d.order_id AND
            (manual.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED') OR
             (manual.status<>'SENT' AND NOT public.notification_submission_definite(manual.id) AND manual.dedupe_until>clock_timestamp() AND EXISTS(SELECT 1 FROM public.admin_notification_resend_attempts a WHERE a.resend_id=manual.id AND a.outcome='UNKNOWN')))))
          AND (d.status='PROCESSING' OR r.dedupe_until<=clock_timestamp()
            OR EXISTS(SELECT 1 FROM public.notification_deliveries later JOIN public.notification_runtime_state later_runtime ON later_runtime.notification_delivery_id=later.id WHERE later.order_id=d.order_id AND later_runtime.event_rank>r.event_rank AND (later.status='SENT' OR later_runtime.link_token_id IS NOT NULL))
            OR NOT EXISTS(SELECT 1 FROM public.outbox_events x CROSS JOIN LATERAL public.notification_source_authority(x.id) source
              LEFT JOIN public.notification_deliveries earlier ON earlier.order_id=source.order_id AND earlier.event_type=source.event_type
              WHERE (x.aggregate_id=d.order_id OR x.secondary_subject_id=d.order_id) AND source.order_id=d.order_id AND source.event_rank<r.event_rank
                AND (earlier.id IS NULL OR earlier.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED'))))
          ) ORDER BY d.created_at,r.event_rank,d.id LIMIT $1::integer`,
          [command.limit],
        );
        return notificationListPendingResultSchema.parse({
          schemaVersion: 1,
          notificationIds: rows.map((row) => row["id"]),
        });
      }),
  };
}
