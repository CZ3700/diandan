import {
  resourceMediaEnqueueCommandSchema,
  resourceMediaJobReadCommandSchema,
  resourceMediaRetryCommandSchema,
  resourceMediaJobResponseSchema,
  mediaProcessingEnqueueCommandSchema,
  contentTimestampSchema,
} from "@fan-support/contracts";
import { hashMediaProcessingCommand } from "@fan-support/content";
import type { ResourceManagementRepository } from "@fan-support/persistence-port";
import { createMediaProcessingRepository } from "./media-processing-repository.js";
import { loadMediaCommand, mediaSnapshot } from "./media-processing-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  resourceEventTime,
  resourceFailure,
  resourceMutation,
  utcTimestampSql,
  writeResourceAudit,
  type ResourceRun,
} from "./resource-management-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export function createResourceProcessingMethods(
  client: TransactionClient,
  scope: TransactionScopeControl,
  run: ResourceRun,
): Pick<
  ResourceManagementRepository,
  "enqueueMedia" | "readMediaJob" | "retryMediaJob"
> {
  const mediaProcessing = createMediaProcessingRepository(client, scope);
  async function receipt(
    command: {
      receiptId: string;
      actorId: string;
      sessionId: string;
      reasonCode: string;
      requestId: string;
    },
    jobId: string,
    action: "ENQUEUE" | "RETRY",
    time: { at: string; auditId: string },
  ) {
    await writeResourceAudit(client, {
      ...command,
      ...time,
      action: `MEDIA_PROCESSING_${action}`,
      subjectType: "MEDIA_PROCESSING_JOB",
      subjectId: jobId,
    });
    await client.query(
      "INSERT INTO public.media_processing_admin_receipts(id,job_id,action,actor_id,session_id,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        command.receiptId,
        jobId,
        action,
        command.actorId,
        command.sessionId,
        time.auditId,
        time.at,
      ],
    );
  }
  return {
    readMediaJob(input) {
      const parsed = resourceMediaJobReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const [row] = await draftRows(
          client,
          "SELECT * FROM public.media_processing_jobs WHERE id=$1",
          [parsed.data.jobId],
        );
        if (!row) return resourceFailure("NOT_FOUND");
        const snapshot = mediaSnapshot(row);
        if (snapshot.outcome !== "SUCCESS")
          return resourceFailure("CONTENT_UNAVAILABLE");
        return resourceMediaJobResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MEDIA_JOB",
          job: {
            schemaVersion: 1,
            snapshot: snapshot.value,
            generation: row["generation"],
            retryOfJobId: row["retry_of_job_id"],
          },
        });
      });
    },
    enqueueMedia(input) {
      const parsed = resourceMediaEnqueueCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        const result = await mediaProcessing.enqueue(
          mediaProcessingEnqueueCommandSchema.parse({
            schemaVersion: 1,
            jobId: command.jobId,
            sourceAssetId: command.sourceAssetId,
            metadataRevisionId: command.metadataRevisionId,
            role: command.role,
            fit: command.fit,
            requestedBy: command.actorId,
            reason: command.reasonCode,
          }),
        );
        if (result.outcome !== "SUCCESS")
          return resourceFailure(
            result.code === "CONFLICT"
              ? "CONFLICT"
              : result.code === "SOURCE_NOT_ELIGIBLE"
                ? "INVALID_CONTENT"
                : "CONTENT_UNAVAILABLE",
          );
        const [job] = await draftRows(
          client,
          `SELECT ${utcTimestampSql("created_at")} AS created_at FROM public.media_processing_jobs WHERE id=$1`,
          [result.value.jobId],
        );
        if (!job) return resourceFailure("CONTENT_UNAVAILABLE");
        await receipt(
          command,
          result.value.jobId,
          "ENQUEUE",
          await resourceEventTime(
            client,
            {
              sessionId: command.sessionId,
              permission: "content.media.process",
            },
            [contentTimestampSchema.parse(job["created_at"])],
          ),
        );
        return resourceMutation(result.value.jobId);
      });
    },
    retryMediaJob(input) {
      const parsed = resourceMediaRetryCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        const [previous] = await draftRows(
          client,
          `SELECT *,${utcTimestampSql("created_at")} AS created_at,${utcTimestampSql("updated_at")} AS updated_at,${utcTimestampSql("completed_at")} AS completed_at FROM public.media_processing_jobs WHERE id=$1 FOR UPDATE`,
          [command.jobId],
        );
        if (!previous) return resourceFailure("NOT_FOUND");
        if (previous["attempt_count"] !== command.expectedVersion)
          return resourceFailure("STALE_VERSION");
        if (previous["status"] !== "FAILED")
          return resourceFailure("INVALID_CONTENT");
        if (
          (
            await draftRows(
              client,
              "SELECT id FROM public.media_processing_jobs WHERE retry_of_job_id=$1",
              [command.jobId],
            )
          ).length > 0
        )
          return resourceFailure("CONFLICT");
        const canonical = await loadMediaCommand(client, {
          sourceAssetId: previous["source_asset_id"],
          metadataRevisionId: previous["source_metadata_revision_id"],
          role: previous["role"],
          fit: previous["fit"],
        });
        if (
          !canonical ||
          hashMediaProcessingCommand(canonical) !== previous["command_hash"]
        )
          return resourceFailure("INVALID_CONTENT");
        const time = await resourceEventTime(
          client,
          { sessionId: command.sessionId, permission: "content.media.process" },
          ["created_at", "updated_at", "completed_at"].map((key) =>
            contentTimestampSchema.parse(previous[key]),
          ),
        );
        await client.query(
          `INSERT INTO public.media_processing_jobs(id,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,requested_by,reason,status,next_attempt_at,created_at,updated_at,generation,retry_of_job_id)
          SELECT $2,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,$3,$4,'PENDING',clock_timestamp(),$5,$5,generation+1,id FROM public.media_processing_jobs WHERE id=$1`,
          [
            command.jobId,
            command.newJobId,
            command.actorId,
            command.reasonCode,
            time.at,
          ],
        );
        await receipt(command, command.newJobId, "RETRY", time);
        return resourceMutation(command.newJobId);
      });
    },
  };
}
