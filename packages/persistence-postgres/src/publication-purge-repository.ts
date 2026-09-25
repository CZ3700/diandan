import {
  publicationPurgeClaimCommandSchema,
  publicationPurgeClaimResponseSchema,
  publicationPurgeRecordCommandSchema,
  publicationPurgeRecordResponseSchema,
} from "@fan-support/contracts";
import type { PublicationPurgeRepository } from "@fan-support/persistence-port";
import { baseContentFailure } from "./base-content-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { createResourceRun } from "./resource-management-data.js";
import {
  appendPurgeAttempt,
  loadPurgeJob,
  purgeJob,
  purgeTime,
} from "./publication-purge-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

/** Durable claims and fenced results; this adapter never makes a network request. */
export function createPublicationPurgeRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): PublicationPurgeRepository {
  const run = createResourceRun(client, scope);
  return {
    claim(input) {
      const parsed = publicationPurgeClaimCommandSchema.safeParse(input);
      if (!parsed.success)
        return scope.trackOperation(async () =>
          baseContentFailure("INVALID_COMMAND"),
        );
      return run(async () => {
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        const [selected] = await draftRows(
          client,
          `SELECT to_jsonb(j.*) AS job FROM public.content_purge_jobs j
          JOIN public.outbox_events e ON e.id=j.outbox_event_id AND e.event_type='CONTENT_PUBLICATION_CHANGED'
          WHERE j.status IN ('PENDING','SUBMITTED') AND j.next_attempt_at<=clock_timestamp()
            AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=clock_timestamp())
          ORDER BY j.next_attempt_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
        );
        const row = selected?.["job"] as DraftRow | undefined;
        if (!row)
          return {
            schemaVersion: 1 as const,
            outcome: "SUCCESS" as const,
            claim: null,
          };
        const time = await purgeTime(client, row),
          version = Number(row["version"]) + 1,
          token = String(time["token"]),
          at = String(time["now"]);
        if (time["expired"] === true) {
          await client.query(
            "UPDATE public.content_purge_jobs SET status='FAILED',version=$2,updated_at=$3,next_attempt_at=NULL,error_code='PURGE_TIMEOUT',lease_token=NULL,lease_expires_at=NULL WHERE id=$1",
            [row["id"], version, at],
          );
          await appendPurgeAttempt(client, {
            jobId: String(row["id"]),
            version,
            leaseToken: String(row["lease_token"] ?? token),
            kind: "TIMEOUT",
            errorCode: "PURGE_TIMEOUT",
            at,
          });
          return {
            schemaVersion: 1 as const,
            outcome: "SUCCESS" as const,
            claim: null,
          };
        }
        await client.query(
          `UPDATE public.content_purge_jobs SET version=$2,attempt_count=attempt_count+1,updated_at=$3,lease_token=$4,
          lease_expires_at=LEAST(clock_timestamp()+$5*interval '1 second',created_at+interval '10 minutes') WHERE id=$1`,
          [row["id"], version, at, token, parsed.data.leaseSeconds],
        );
        await appendPurgeAttempt(client, {
          jobId: String(row["id"]),
          version,
          leaseToken: token,
          kind: "CLAIM",
          errorCode: null,
          at,
        });
        const saved = await loadPurgeJob(client, String(row["id"]));
        if (!saved) throw new Error("Claimed purge job is unavailable");
        return publicationPurgeClaimResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          claim: {
            schemaVersion: 1,
            job: purgeJob(saved),
            leaseToken: token,
            version,
            purgeReference: saved["purge_reference"],
            paths: saved["paths"],
            idempotencyKey: `publication-purge:${String(saved["id"])}`,
          },
        });
      });
    },
    record(input) {
      const parsed = publicationPurgeRecordCommandSchema.safeParse(input);
      if (!parsed.success)
        return scope.trackOperation(async () =>
          baseContentFailure("INVALID_COMMAND"),
        );
      return run(async () => {
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        const command = parsed.data,
          row = await loadPurgeJob(client, command.jobId);
        if (!row) return baseContentFailure("NOT_FOUND");
        const [lease] = await draftRows(
          client,
          "SELECT lease_token=$2::uuid AND lease_expires_at>clock_timestamp() AS valid FROM public.content_purge_jobs WHERE id=$1",
          [command.jobId, command.leaseToken],
        );
        if (
          Number(row["version"]) !== command.expectedVersion ||
          lease?.["valid"] !== true ||
          !["PENDING", "SUBMITTED"].includes(String(row["status"]))
        )
          return baseContentFailure("CONFLICT");
        const time = await purgeTime(client, row),
          result = command.result,
          version = command.expectedVersion + 1,
          at = String(time["now"]);
        let status = String(row["status"]),
          reference = row["purge_reference"],
          failureCount = Number(row["failure_count"]),
          errorCode: string | null = null,
          kind: string = result.kind,
          delay = 2;
        if (time["expired"] === true) {
          status = "FAILED";
          errorCode = "PURGE_TIMEOUT";
          kind = "TIMEOUT";
        } else if (result.kind === "FAILURE") {
          failureCount++;
          errorCode = result.code;
          if (!result.retryable || failureCount >= 6) status = "FAILED";
          delay = Math.min(60, 2 ** failureCount);
        } else if (result.kind === "PENDING") {
          if (status !== "SUBMITTED")
            return baseContentFailure("INVALID_COMMAND");
        } else if (result.kind === "SUBMITTED") {
          if (status !== "PENDING")
            return baseContentFailure("INVALID_COMMAND");
          status = "SUBMITTED";
          reference = result.purgeReference;
        } else {
          if (reference !== null && reference !== result.purgeReference)
            return baseContentFailure("INVALID_COMMAND");
          status = "COMPLETED";
          reference = result.purgeReference;
        }
        await client.query(
          `UPDATE public.content_purge_jobs SET version=$2,status=$3,updated_at=$4::timestamptz,lease_token=NULL,lease_expires_at=NULL,purge_reference=$5,
          failure_count=$6,error_code=$7,completed_at=CASE WHEN $3='COMPLETED' THEN $4::timestamptz ELSE NULL END,
          next_attempt_at=CASE WHEN $3 IN ('COMPLETED','FAILED') THEN NULL ELSE LEAST(clock_timestamp()+$8*interval '1 second',created_at+interval '10 minutes') END WHERE id=$1`,
          [
            command.jobId,
            version,
            status,
            at,
            reference,
            failureCount,
            errorCode,
            delay,
          ],
        );
        await appendPurgeAttempt(client, {
          jobId: command.jobId,
          version,
          leaseToken: command.leaseToken,
          kind,
          errorCode,
          at,
        });
        const saved = await loadPurgeJob(client, command.jobId);
        if (!saved) throw new Error("Recorded purge job is unavailable");
        return publicationPurgeRecordResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          job: purgeJob(saved),
        });
      });
    },
  };
}
