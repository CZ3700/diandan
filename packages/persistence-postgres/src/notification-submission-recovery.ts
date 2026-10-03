import { notificationSubmissionDefiniteResultSchema } from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Recover a committed definite result after the sender crashed before finishing its delivery.
 * The caller holds the original delivery lock. Claim recovery excludes an active lease.
 * This reads a receipt only; it never authorizes another network submission.
 */
export async function definiteNotificationSubmission(
  client: TransactionClient,
  delivery: DraftRow,
) {
  const [row] = await draftRows(
    client,
    "SELECT result FROM public.notification_submissions WHERE notification_id=$1::uuid AND transport_key=$2 AND idempotency_key=$3 AND request_hash=$4 AND dispatch_not_after=$5::timestamptz AND status='COMPLETE' FOR UPDATE",
    [
      delivery["id"],
      delivery["transport_key"],
      delivery["idempotency_key"],
      delivery["content_hash"],
      delivery["dedupe_until"],
    ],
  );
  const parsed = notificationSubmissionDefiniteResultSchema.safeParse(
    row?.["result"],
  );
  return parsed.success ? parsed.data : undefined;
}

/** Correct only a terminal UNKNOWN projection backed by its immutable accepted receipt.
 * This records no new attempt, lease, token or external operation.
 */
export async function recoverFailedNotificationSubmission(
  client: TransactionClient,
  delivery: DraftRow,
  now: string,
  kind: "automatic" | "manual",
) {
  const recorded = await definiteNotificationSubmission(client, delivery);
  if (recorded?.outcome !== "SUCCESS" || recorded.value.status !== "ACCEPTED")
    return;
  const table =
    kind === "automatic"
      ? "notification_deliveries"
      : "admin_notification_resends";
  await client.query(
    `UPDATE public.${table} SET status='SENT',sent_at=$2::timestamptz,last_error_code=NULL,version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid AND public.notification_submission_recoverable(id)`,
    [delivery["id"], now],
  );
}
