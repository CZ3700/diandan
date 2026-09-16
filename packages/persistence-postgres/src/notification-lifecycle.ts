import { randomUUID } from "node:crypto";
import {
  notificationClaimResultSchema,
  type NotificationClaimCommand,
  type NotificationFinishCommand,
  type NotificationPortResponse,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  currentNotificationLease,
  hasLaterNotification,
  lockNotification,
  notificationClock,
  notificationFailed,
  notificationSkip,
} from "./notification-data.js";
import type { TransactionClient } from "./transaction-runner.js";

type Completion = {
  status: "SENT" | "RETRY_SCHEDULED" | "FAILED";
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  errorCode: string | null;
  providerReference: string | null;
};
export function notificationCompletion(
  result: NotificationPortResponse,
  attempt: number,
  maxAttempts: number,
  withinWindow: boolean,
): Completion {
  if (result.outcome === "SUCCESS")
    return result.value.status === "ACCEPTED"
      ? {
          status: "SENT",
          outcome: "SUCCEEDED",
          errorCode: null,
          providerReference: result.value.providerReference,
        }
      : {
          status: "FAILED",
          outcome: "FAILED",
          errorCode: "RECIPIENT_REJECTED",
          providerReference: null,
        };
  const unknown = [
    "TIMEOUT_OUTCOME_UNKNOWN",
    "MALFORMED_PROVIDER_RESPONSE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(result.error.code);
  const retry =
    result.error.recovery === "RETRY_SAME_COMMAND" &&
    attempt < maxAttempts &&
    withinWindow;
  return {
    status: retry ? "RETRY_SCHEDULED" : "FAILED",
    outcome: unknown ? "UNKNOWN" : "FAILED",
    errorCode: withinWindow ? result.error.code : "IDEMPOTENCY_WINDOW_EXPIRED",
    providerReference: null,
  };
}

export async function completeNotification(
  client: TransactionClient,
  row: DraftRow,
  completion: Completion,
  now: string,
  retrySeconds: number,
) {
  await client.query(
    `INSERT INTO public.notification_delivery_attempts(id,notification_delivery_id,sequence,outcome,provider_delivery_reference,error_code,started_at,completed_at,created_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$8::timestamptz)`,
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
    `UPDATE public.notification_deliveries SET status=$2,attempt_count=attempt_count+1,next_attempt_at=CASE WHEN $2::text='RETRY_SCHEDULED' THEN $3::timestamptz+($4::integer*interval '1 second') ELSE NULL END,sent_at=CASE WHEN $2::text='SENT' THEN $3::timestamptz ELSE NULL END,last_error_code=$5,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
    [row["id"], completion.status, now, retrySeconds, completion.errorCode],
  );
  await client.query(
    `UPDATE public.notification_runtime_state SET lease_token=NULL,lease_expires_at=NULL,lease_started_at=NULL,updated_at=$2::timestamptz WHERE notification_delivery_id=$1::uuid`,
    [row["id"], now],
  );
  row["attempt_count"] = Number(row["attempt_count"]) + 1;
  row["status"] = completion.status;
}

export async function stopNotification(
  client: TransactionClient,
  row: DraftRow,
  code: string,
  now: string,
) {
  if (row["status"] === "PROCESSING")
    return completeNotification(
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
  if (row["status"] === "REQUESTED" || row["status"] === "RETRY_SCHEDULED")
    await client.query(
      `UPDATE public.notification_deliveries SET status=CASE WHEN status='REQUESTED' THEN 'CANCELED' ELSE 'FAILED' END,next_attempt_at=NULL,last_error_code=$2,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
      [row["id"], code, now],
    );
}

async function lowerNotificationPending(
  client: TransactionClient,
  row: DraftRow,
) {
  const [value] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.outbox_events x CROSS JOIN LATERAL public.notification_source_authority(x.id) s LEFT JOIN public.notification_deliveries d ON d.order_id=s.order_id AND d.event_type=s.event_type WHERE (x.aggregate_id=$1::uuid OR x.secondary_subject_id=$1::uuid) AND s.order_id=$1::uuid AND s.event_rank<$2::integer AND (d.id IS NULL OR d.status IN('REQUESTED','PROCESSING','RETRY_SCHEDULED'))) blocked`,
    [row["order_id"], row["event_rank"]],
  );
  return value?.["blocked"] === true;
}

export async function claimNotification(
  client: TransactionClient,
  command: NotificationClaimCommand,
) {
  const row = await lockNotification(client, command.notificationId);
  if (
    !row ||
    !["REQUESTED", "PROCESSING", "RETRY_SCHEDULED"].includes(
      String(row["status"]),
    )
  )
    return notificationSkip;
  const now = await notificationClock(client),
    time = Date.parse(now);
  const withinWindow = Date.parse(String(row["dedupe_until"])) > time;
  if (row["status"] === "PROCESSING") {
    if (Date.parse(String(row["lease_expires_at"])) > time)
      return notificationSkip;
    const retry =
      withinWindow && Number(row["attempt_count"]) + 1 < command.maxAttempts;
    await completeNotification(
      client,
      row,
      {
        status: retry ? "RETRY_SCHEDULED" : "FAILED",
        outcome: "UNKNOWN",
        errorCode: withinWindow
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
  if (!withinWindow || Number(row["attempt_count"]) >= command.maxAttempts) {
    if (row["status"] === "REQUESTED") {
      await client.query(
        `UPDATE public.notification_deliveries SET status='PROCESSING',next_attempt_at=NULL,last_error_code=NULL,version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid`,
        [command.notificationId, now],
      );
      await client.query(
        `UPDATE public.notification_runtime_state SET lease_token=$2::uuid,lease_started_at=$3::timestamptz,lease_expires_at=$3::timestamptz+($4::integer*interval '1 second'),generation=generation+1,updated_at=$3::timestamptz WHERE notification_delivery_id=$1::uuid`,
        [command.notificationId, command.leaseToken, now, command.leaseSeconds],
      );
      row["status"] = "PROCESSING";
      row["lease_started_at"] = now;
    }
    await stopNotification(
      client,
      row,
      withinWindow ? "ATTEMPT_LIMIT_REACHED" : "IDEMPOTENCY_WINDOW_EXPIRED",
      now,
    );
    return notificationFailed;
  }
  if (await hasLaterNotification(client, row)) {
    const failure = row["status"] === "RETRY_SCHEDULED";
    await stopNotification(client, row, "SUPERSEDED_NOTIFICATION", now);
    return failure ? notificationFailed : notificationSkip;
  }
  if (
    (row["next_attempt_at"] !== null &&
      Date.parse(String(row["next_attempt_at"])) > time) ||
    (await lowerNotificationPending(client, row))
  )
    return notificationSkip;
  await client.query(
    `UPDATE public.notification_deliveries SET status='PROCESSING',next_attempt_at=NULL,last_error_code=NULL,version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid`,
    [command.notificationId, now],
  );
  await client.query(
    `UPDATE public.notification_runtime_state SET lease_token=$2::uuid,lease_started_at=$3::timestamptz,lease_expires_at=LEAST($3::timestamptz+($4::integer*interval '1 second'),dedupe_until),generation=generation+1,updated_at=$3::timestamptz WHERE notification_delivery_id=$1::uuid`,
    [command.notificationId, command.leaseToken, now, command.leaseSeconds],
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

export async function finishNotification(
  client: TransactionClient,
  command: NotificationFinishCommand,
) {
  const row = await lockNotification(client, command.notificationId);
  if (!row || !(await currentNotificationLease(client, command, false)))
    return notificationSkip;
  const now = await notificationClock(client);
  const completion = notificationCompletion(
    command.result,
    Number(row["attempt_count"]) + 1,
    command.maxAttempts,
    Date.parse(String(row["dedupe_until"])) > Date.parse(now),
  );
  await completeNotification(
    client,
    row,
    completion,
    now,
    command.retryDelaySeconds,
  );
  return { schemaVersion: 1 as const, decision: completion.status };
}
