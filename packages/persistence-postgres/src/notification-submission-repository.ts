import {
  notificationSubmissionClaimCommandSchema,
  notificationSubmissionClaimResultSchema,
  notificationSubmissionFinishCommandSchema,
  type NotificationSubmissionClaimCommand,
} from "@fan-support/contracts";
import {
  NotificationRepositoryError,
  type NotificationSubmissionRepository,
} from "@fan-support/persistence-port";
import { lockAdminNotificationResend } from "./admin-notification-resend-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { lockNotification, rejectNotification } from "./notification-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const decision = <Value extends string>(value: Value) => ({
  schemaVersion: 1 as const,
  decision: value,
});

async function lockSource(
  client: TransactionClient,
  command: NotificationSubmissionClaimCommand,
) {
  const automatic = await lockNotification(client, command.notificationId);
  const row =
    automatic ??
    (await lockAdminNotificationResend(client, command.notificationId));
  if (
    !row ||
    row["transport_key"] !== command.transportKey ||
    row["idempotency_key"] !== command.idempotencyKey ||
    row["content_hash"] !== command.requestHash
  )
    return undefined;
  const [identity] = await draftRows(
    client,
    "SELECT $1::timestamptz=$2::timestamptz valid",
    [row["dedupe_until"], command.dispatchNotAfter],
  );
  return identity?.["valid"] === true
    ? { row, automatic: Boolean(automatic) }
    : undefined;
}

async function lockSubmission(
  client: TransactionClient,
  command: NotificationSubmissionClaimCommand,
) {
  // The owning cart/order/delivery was locked first. Serialize an accidental cross-order key collision.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `native-mail:${command.transportKey}:${command.idempotencyKey}`,
  ]);
  const [row] = await draftRows(
    client,
    "SELECT *,dispatch_not_after=$4::timestamptz deadline_matches FROM public.notification_submissions WHERE (transport_key=$1 AND idempotency_key=$2) OR notification_id=$3::uuid FOR UPDATE",
    [
      command.transportKey,
      command.idempotencyKey,
      command.notificationId,
      command.dispatchNotAfter,
    ],
  );
  return row;
}
function sameIdentity(
  row: DraftRow,
  command: NotificationSubmissionClaimCommand,
) {
  return (
    row["transport_key"] === command.transportKey &&
    row["idempotency_key"] === command.idempotencyKey &&
    row["notification_id"] === command.notificationId.toLowerCase() &&
    row["request_hash"] === command.requestHash &&
    row["deadline_matches"] === true
  );
}

export function createNotificationSubmissionRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): NotificationSubmissionRepository {
  const run = <Result>(work: () => Promise<Result>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof NotificationRepositoryError) throw error;
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    claim: (input) =>
      run(async () => {
        const parsed =
          notificationSubmissionClaimCommandSchema.safeParse(input);
        if (!parsed.success) return rejectNotification("INVALID_COMMAND");
        const command = parsed.data;
        const source = await lockSource(client, command);
        if (!source) return decision("CONFLICT");
        const prior = await lockSubmission(client, command);
        if (prior) {
          if (!sameIdentity(prior, command)) return decision("CONFLICT");
          return prior["status"] === "UNKNOWN"
            ? decision("UNKNOWN")
            : notificationSubmissionClaimResultSchema.parse({
                schemaVersion: 1,
                decision: "REPLAY",
                result: prior["result"],
              });
        }
        const [clock] = await draftRows(
          client,
          "SELECT $1::timestamptz>clock_timestamp() unexpired,public.notification_submission_unresolved($2::uuid,$3::uuid) blocked",
          [
            command.dispatchNotAfter,
            source.row["order_id"],
            command.notificationId,
          ],
        );
        if (clock?.["unexpired"] !== true) return decision("EXPIRED");
        if (clock["blocked"] === true || source.row["status"] !== "PROCESSING")
          return decision("CONFLICT");
        await client.query(
          "INSERT INTO public.notification_submissions(transport_key,idempotency_key,notification_id,automatic_notification_id,admin_resend_id,request_hash,dispatch_not_after,claim_token,status,created_at) VALUES($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7::timestamptz,$8::uuid,'UNKNOWN',clock_timestamp())",
          [
            command.transportKey,
            command.idempotencyKey,
            command.notificationId,
            source.automatic ? command.notificationId : null,
            source.automatic ? null : command.notificationId,
            command.requestHash,
            command.dispatchNotAfter,
            command.claimToken,
          ],
        );
        return decision("SEND");
      }),
    finish: (input) =>
      run(async () => {
        const parsed =
          notificationSubmissionFinishCommandSchema.safeParse(input);
        if (!parsed.success) return rejectNotification("INVALID_COMMAND");
        const command = parsed.data;
        if (!(await lockSource(client, command))) return decision("CONFLICT");
        const prior = await lockSubmission(client, command);
        if (
          !prior ||
          !sameIdentity(prior, command) ||
          prior["claim_token"] !== command.claimToken.toLowerCase()
        )
          return decision("CONFLICT");
        if (prior["status"] === "COMPLETE") {
          const [same] = await draftRows(
            client,
            "SELECT $1::jsonb=$2::jsonb same",
            [JSON.stringify(prior["result"]), JSON.stringify(command.result)],
          );
          return decision(same?.["same"] === true ? "REPLAY" : "CONFLICT");
        }
        await client.query(
          "UPDATE public.notification_submissions SET status='COMPLETE',result=$3::jsonb,completed_at=clock_timestamp() WHERE transport_key=$1 AND idempotency_key=$2 AND status='UNKNOWN'",
          [
            command.transportKey,
            command.idempotencyKey,
            JSON.stringify(command.result),
          ],
        );
        return decision("STORED");
      }),
  };
}
