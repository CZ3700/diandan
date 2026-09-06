import {
  contentTimestampSchema,
  type PublicationRuntimeRetryWriteCommand,
} from "@fan-support/contracts";
import { baseContentFailure } from "./base-content-data.js";
import { draftRows } from "./content-draft-data.js";
import { loadPurgeJob } from "./publication-purge-data.js";
import {
  readPublicationReceipt,
  writePublicationAudit,
} from "./publication-runtime-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function retryPublicationPurge(
  client: TransactionClient,
  input: PublicationRuntimeRetryWriteCommand,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const command = input.command,
    prior = await loadPurgeJob(client, command.purgeJobId);
  if (!prior || prior["publication_id"] !== command.publicationId.toLowerCase())
    return baseContentFailure("NOT_FOUND");
  if (Number(prior["version"]) !== command.expectedVersion)
    return baseContentFailure("STALE_VERSION");
  if (prior["status"] !== "FAILED")
    return baseContentFailure("INVALID_REVIEW_STATE");
  const [successor] = await draftRows(
    client,
    "SELECT id FROM public.content_purge_jobs WHERE retry_of=$1",
    [command.purgeJobId],
  );
  if (successor) return baseContentFailure("CONFLICT");
  const [time] = await draftRows(
    client,
    `SELECT gen_random_uuid() AS result_id,gen_random_uuid() AS job_id,gen_random_uuid() AS audit_id,${utcTimestampSql("GREATEST(clock_timestamp(),transaction_timestamp(),$1::timestamptz,$2::timestamptz)")} AS now`,
    [prior["updated_at"], input.principal.authorizedAt],
  );
  if (!time) throw new Error("Purge retry event time unavailable");
  const at = contentTimestampSchema.parse(time["now"]),
    jobId = String(time["job_id"]),
    resultId = String(time["result_id"]),
    auditId = String(time["audit_id"]),
    generation = Number(prior["generation"]) + 1;
  await writePublicationAudit(client, {
    id: auditId,
    actorId: input.principal.actorId,
    action: "CONTENT_PURGE_RETRY",
    subjectType: "CONTENT_PURGE_JOB",
    subjectId: jobId,
    requestId: input.requestId,
    reasonCode: command.reasonCode,
    at,
  });
  await client.query(
    `INSERT INTO public.content_purge_jobs(id,publication_id,outbox_event_id,locale,generation,retry_of,paths,created_at,updated_at,next_attempt_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)`,
    [
      jobId,
      prior["publication_id"],
      prior["outbox_event_id"],
      prior["locale"],
      generation,
      command.purgeJobId,
      prior["paths"],
      at,
    ],
  );
  await client.query(
    `INSERT INTO public.content_publication_receipts(id,action,actor_id,session_id,audit_log_id,publication_id,purge_job_id,expected_version,result_generation,result_version,created_at,field_paths)
    VALUES($1,'RETRY_PURGE',$2,$3,$4,$5,$6,$7,$8,1,$9,ARRAY['cachePurge'])`,
    [
      resultId,
      input.principal.actorId,
      input.principal.sessionId,
      auditId,
      command.publicationId,
      jobId,
      command.expectedVersion,
      generation,
      at,
    ],
  );
  return readPublicationReceipt(client, resultId, input.principal.actorId);
}
