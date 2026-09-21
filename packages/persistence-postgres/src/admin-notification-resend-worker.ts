import {
  notificationSourceCommandSchema,
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
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  notificationIgnored,
  rejectNotification,
} from "./notification-data.js";
import {
  claimAdminResend,
  finishAdminResend,
} from "./admin-notification-resend-lifecycle.js";
import {
  adminResendRecipient,
  attachAdminResendLink,
  confirmAdminResendSend,
} from "./admin-notification-resend-access.js";
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
/** Implements the existing sender port over the separate ID-only resend outbox. */
export function createAdminOrderResendNotificationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
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
      run(
        notificationSourceCommandSchema,
        input,
        async () => notificationIgnored,
      ),
    request: (input) =>
      run(
        notificationRequestCommandSchema,
        input,
        async () => notificationIgnored,
      ),
    claim: (input) =>
      run(notificationClaimCommandSchema, input, (command) =>
        claimAdminResend(client, command),
      ),
    attachLink: (input) =>
      run(notificationAttachLinkCommandSchema, input, (command) =>
        attachAdminResendLink(client, command),
      ),
    recipient: (input) =>
      run(notificationLeaseCommandSchema, input, (command) =>
        adminResendRecipient(client, command),
      ),
    confirmSend: (input) =>
      run(notificationConfirmSendCommandSchema, input, (command) =>
        confirmAdminResendSend(client, command),
      ),
    finish: (input) =>
      run(notificationFinishCommandSchema, input, (command) =>
        finishAdminResend(client, command),
      ),
    listPending: (input) =>
      run(notificationListPendingCommandSchema, input, async (command) => {
        const rows = await draftRows(
          client,
          `SELECT r.id FROM public.admin_notification_resend_outbox q JOIN public.admin_notification_resends r ON r.id=q.resend_id WHERE r.status='REQUESTED' OR (r.status='RETRY_SCHEDULED' AND (r.next_attempt_at<=clock_timestamp() OR r.dedupe_until<=clock_timestamp() OR public.admin_notification_current_event(r.order_id) IS DISTINCT FROM r.event_type)) OR (r.status='PROCESSING' AND r.lease_expires_at<=clock_timestamp()) ORDER BY q.created_at,r.id LIMIT $1::integer`,
          [command.limit],
        );
        return notificationListPendingResultSchema.parse({
          schemaVersion: 1,
          notificationIds: rows.map((row) => row["id"]),
        });
      }),
  };
}
