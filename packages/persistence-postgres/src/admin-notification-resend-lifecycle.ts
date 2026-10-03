import { randomUUID } from "node:crypto";
import {
  notificationClaimResultSchema,
  type NotificationClaimCommand,
  type NotificationFinishCommand,
} from "@fan-support/contracts";
import type { DraftRow } from "./content-draft-data.js";
import {
  notificationClock,
  notificationFailed,
  notificationSkip,
} from "./notification-data.js";
import { notificationCompletion } from "./notification-lifecycle.js";
import {
  adminResendIsCurrent,
  currentAdminResendLease,
  lockAdminNotificationResend,
} from "./admin-notification-resend-data.js";
import type { TransactionClient } from "./transaction-runner.js";
import {
  definiteNotificationSubmission,
  recoverFailedNotificationSubmission,
} from "./notification-submission-recovery.js";
type Completion = ReturnType<typeof notificationCompletion>;
export async function completeAdminResend(
  client: TransactionClient,
  row: DraftRow,
  completion: Completion,
  now: string,
  retrySeconds: number,
) {
  await client.query(
    `INSERT INTO public.admin_notification_resend_attempts(id,resend_id,sequence,outcome,provider_delivery_reference,error_code,started_at,completed_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)`,
    [
      randomUUID(),
      row["id"],
      Number(row["attempt_count"]) + 1,
      completion.outcome,
      completion.providerReference,
      completion.errorCode,
      row["lease_started_at"],
      now,
    ],
  );
  await client.query(
    `UPDATE public.admin_notification_resends SET status=$2,attempt_count=attempt_count+1,next_attempt_at=CASE WHEN $2::text='RETRY_SCHEDULED' THEN $3::timestamptz+($4::integer*interval '1 second') ELSE NULL END,sent_at=CASE WHEN $2::text='SENT' THEN $3::timestamptz ELSE NULL END,last_error_code=$5,lease_token=NULL,lease_expires_at=NULL,lease_started_at=NULL,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
    [row["id"], completion.status, now, retrySeconds, completion.errorCode],
  );
  row["attempt_count"] = Number(row["attempt_count"]) + 1;
  row["status"] = completion.status;
}
export async function stopAdminResend(
  client: TransactionClient,
  row: DraftRow,
  code: string,
  now: string,
) {
  if (row["status"] === "PROCESSING")
    return completeAdminResend(
      client,
      row,
      {
        status: "FAILED",
        outcome: "FAILED",
        errorCode: code,
        providerReference: null,
      },
      now,
      0,
    );
  if (row["status"] === "REQUESTED" || row["status"] === "RETRY_SCHEDULED") {
    await client.query(
      "UPDATE public.admin_notification_resends SET status='CANCELED',next_attempt_at=NULL,last_error_code=$2,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid",
      [row["id"], code, now],
    );
    row["status"] = "CANCELED";
  }
}
export async function claimAdminResend(
  client: TransactionClient,
  command: NotificationClaimCommand,
) {
  const row = await lockAdminNotificationResend(client, command.notificationId);
  if (
    !row ||
    ![
      "REQUESTED",
      "PROCESSING",
      "RETRY_SCHEDULED",
      "FAILED",
      "CANCELED",
    ].includes(String(row["status"]))
  )
    return notificationSkip;
  const now = await notificationClock(client),
    time = Date.parse(now),
    within = Date.parse(String(row["dedupe_until"])) > time;
  if (row["status"] === "FAILED" || row["status"] === "CANCELED") {
    await recoverFailedNotificationSubmission(client, row, now, "manual");
    return notificationSkip;
  }
  if (
    row["status"] === "PROCESSING" &&
    Date.parse(String(row["lease_expires_at"])) > time
  )
    return notificationSkip;
  if (
    row["status"] === "PROCESSING" ||
    (row["status"] === "RETRY_SCHEDULED" &&
      (!within || Date.parse(String(row["next_attempt_at"])) <= time))
  ) {
    const recorded = await definiteNotificationSubmission(client, row);
    if (recorded) {
      if (row["status"] === "RETRY_SCHEDULED") {
        await client.query(
          "UPDATE public.admin_notification_resends SET status='PROCESSING',next_attempt_at=NULL,last_error_code=NULL,lease_token=$2::uuid,lease_started_at=$3::timestamptz,lease_expires_at=$3::timestamptz+($4::integer*interval '1 second'),generation=generation+1,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid",
          [
            command.notificationId,
            command.leaseToken,
            now,
            command.leaseSeconds,
          ],
        );
        row["status"] = "PROCESSING";
        row["lease_started_at"] = now;
      }
      await completeAdminResend(
        client,
        row,
        notificationCompletion(
          recorded,
          Number(row["attempt_count"]) + 1,
          command.maxAttempts,
          within,
        ),
        now,
        0,
      );
      return notificationSkip;
    }
  }
  if (row["status"] === "PROCESSING") {
    const retry =
      within && Number(row["attempt_count"]) + 1 < command.maxAttempts;
    await completeAdminResend(
      client,
      row,
      {
        status: retry ? "RETRY_SCHEDULED" : "FAILED",
        outcome: "UNKNOWN",
        errorCode: within
          ? "LEASE_EXPIRED_OUTCOME_UNKNOWN"
          : "IDEMPOTENCY_WINDOW_EXPIRED",
        providerReference: null,
      },
      now,
      0,
    );
    row["next_attempt_at"] = now;
    if (!retry) return notificationFailed;
  }
  if (!within || Number(row["attempt_count"]) >= command.maxAttempts) {
    await stopAdminResend(
      client,
      row,
      within ? "ATTEMPT_LIMIT_REACHED" : "IDEMPOTENCY_WINDOW_EXPIRED",
      now,
    );
    return notificationFailed;
  }
  if (!(await adminResendIsCurrent(client, row))) {
    await stopAdminResend(client, row, "SUPERSEDED_NOTIFICATION", now);
    return notificationSkip;
  }
  if (
    row["next_attempt_at"] !== null &&
    Date.parse(String(row["next_attempt_at"])) > time
  )
    return notificationSkip;
  // A new automatic stage waits for this dispatch; creation is forbidden while any automatic stage is active.
  await client.query(
    `UPDATE public.admin_notification_resends SET status='PROCESSING',next_attempt_at=NULL,last_error_code=NULL,lease_token=$2::uuid,lease_started_at=$3::timestamptz,lease_expires_at=LEAST($3::timestamptz+($4::integer*interval '1 second'),dedupe_until),generation=generation+1,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
    [row["id"], command.leaseToken, now, command.leaseSeconds],
  );
  return notificationClaimResultSchema.parse({
    schemaVersion: 1,
    decision: "READY",
    plan: {
      schemaVersion: 1,
      notification: {
        schemaVersion: 1,
        id: row["id"],
        orderId: row["order_id"],
        customerContactId: row["customer_contact_id"],
        eventType: row["event_type"],
        locale: {
          schemaVersion: 1,
          requestedLocale: row["requested_locale"],
          resolvedLocale: row["resolved_locale"],
          fallbackUsed: row["fallback_used"],
          templateKey: row["template_key"],
          templateVersion: row["template_version"],
          contentRevisionIds: [],
        },
        idempotencyKey: row["idempotency_key"],
        correlationId: row["correlation_id"],
      },
      baseVariables: row["base_variables"],
      publicStorefrontOrigin: row["public_storefront_origin"],
      transportKey: row["transport_key"],
      linkNonce: row["link_nonce"],
      linkPepperVersion: row["link_pepper_version"],
      linkTtlSeconds: row["link_ttl_seconds"],
      dedupeUntil: row["dedupe_until"],
      leaseToken: command.leaseToken,
      attemptNumber: Number(row["attempt_count"]) + 1,
    },
  });
}
export async function finishAdminResend(
  client: TransactionClient,
  command: NotificationFinishCommand,
) {
  const row = await lockAdminNotificationResend(client, command.notificationId);
  if (!row || !(await currentAdminResendLease(client, command, false)))
    return notificationSkip;
  const now = await notificationClock(client);
  const completion = notificationCompletion(
    (await definiteNotificationSubmission(client, row)) ?? command.result,
    Number(row["attempt_count"]) + 1,
    command.maxAttempts,
    Date.parse(String(row["dedupe_until"])) > Date.parse(now),
  );
  await completeAdminResend(
    client,
    row,
    completion,
    now,
    command.retryDelaySeconds,
  );
  return { schemaVersion: 1 as const, decision: completion.status };
}
