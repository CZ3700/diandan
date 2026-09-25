import { publicationPurgeJobSchema } from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export function purgeJob(row: DraftRow) {
  return publicationPurgeJobSchema.parse({
    schemaVersion: 1,
    id: row["id"],
    publicationId: row["publication_id"],
    outboxEventId: row["outbox_event_id"],
    locale: row["locale"],
    generation: Number(row["generation"]),
    retryOf: row["retry_of"],
    status: row["status"],
    version: Number(row["version"]),
    attemptCount: Number(row["attempt_count"]),
    failureCount: Number(row["failure_count"]),
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
    nextAttemptAt: row["next_attempt_at"],
    completedAt: row["completed_at"],
    errorCode: row["error_code"],
  });
}
export async function loadPurgeJob(client: TransactionClient, id: string) {
  const [result] = await draftRows(
    client,
    "SELECT to_jsonb(j.*) AS job FROM public.content_purge_jobs j WHERE id=$1 FOR UPDATE",
    [id],
  );
  return result?.["job"] as DraftRow | undefined;
}
export async function purgeTime(client: TransactionClient, row: DraftRow) {
  const [time] = await draftRows(
    client,
    // Event ordering uses stable transaction time and locked history. Expiry remains wall-clock based.
    `SELECT gen_random_uuid() AS id,gen_random_uuid() AS token,${utcTimestampSql("GREATEST(transaction_timestamp(),$1::timestamptz)")} AS now,
    clock_timestamp()>=$2::timestamptz+interval '10 minutes' AS expired`,
    [row["updated_at"], row["created_at"]],
  );
  if (!time) throw new Error("Purge event time is unavailable");
  return time;
}
export async function appendPurgeAttempt(
  client: TransactionClient,
  entry: {
    jobId: string;
    version: number;
    leaseToken: string;
    kind: string;
    errorCode: string | null;
    at: string;
  },
) {
  await client.query(
    "INSERT INTO public.content_purge_attempts(id,job_id,job_version,lease_token,kind,error_code,created_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)",
    [
      entry.jobId,
      entry.version,
      entry.leaseToken,
      entry.kind,
      entry.errorCode,
      entry.at,
    ],
  );
}
