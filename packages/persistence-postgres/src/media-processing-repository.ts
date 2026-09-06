import {
  mediaProcessingEnqueueCommandSchema,
  mediaProcessingReadCommandSchema,
  mediaProcessingClaimCommandSchema,
  mediaProcessingCompleteCommandSchema,
  mediaProcessingFailCommandSchema,
  mediaProcessingClaimResponseSchema,
  type MediaProcessingClaimResponse,
  type MediaProcessingSnapshotResponse,
  type MediaProcessingError,
} from "@fan-support/contracts";
import {
  hashMediaProcessingCommand,
  validateMediaProcessingReceipt,
} from "@fan-support/content";
import {
  parsePersistenceTransactionFailure,
  type MediaProcessingRepository,
} from "@fan-support/persistence-port";
import { classifyPostgresFailure } from "./errors.js";
import {
  loadMediaCommand,
  loadMediaJob,
  mediaRows,
  mediaSnapshot,
  mediaTimestamp,
  mediaReceiptHash,
  type MediaRow,
} from "./media-processing-data.js";
import {
  persistMediaOutputs,
  MediaOutputConflict,
} from "./media-processing-outputs.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

type Failure = Extract<MediaProcessingSnapshotResponse, { outcome: "FAILURE" }>;
const failure = (code: Failure["code"]): Failure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const timeoutError = { code: "PROCESSING_TIMEOUT", retryable: true } as const;

export function createMediaProcessingRepository(
  client: TransactionClient,
  transactionScope: TransactionScopeControl,
): MediaProcessingRepository {
  let tail: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  function run<
    Result extends
      MediaProcessingSnapshotResponse | MediaProcessingClaimResponse,
  >(work: () => Promise<Result>): Promise<Result | Failure> {
    return transactionScope.trackOperation(() => {
      const operation = tail.then(async () => {
        const savepoint = `media_processing_${++sequence}`;
        let opened = false;
        let atBoundary = true;
        try {
          await client.query(`SAVEPOINT ${savepoint}`);
          opened = true;
          atBoundary = false;
          const result = await work();
          atBoundary = true;
          if (result.outcome === "FAILURE")
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error: unknown) {
          if (atBoundary)
            throw persistenceTransactionFailureFromPostgres(error);
          if (opened) {
            try {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            } catch (boundaryError: unknown) {
              throw persistenceTransactionFailureFromPostgres(boundaryError);
            }
          }
          const code =
            parsePersistenceTransactionFailure(error)?.error.code ??
            classifyPostgresFailure(error).code;
          return failure(
            error instanceof MediaOutputConflict ||
              code === "ALREADY_EXISTS" ||
              code === "TRANSACTION_ABORTED" ||
              code === "VERSION_CONFLICT"
              ? "CONFLICT"
              : "UNAVAILABLE",
          );
        }
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    });
  }
  async function snapshot(
    id: string,
  ): Promise<MediaProcessingSnapshotResponse> {
    const row = await loadMediaJob(client, id);
    return row === undefined ? failure("NOT_FOUND") : mediaSnapshot(row);
  }
  async function currentLease(row: MediaRow, token: string): Promise<boolean> {
    if (
      row["status"] !== "PROCESSING" ||
      row["lease_token"] !== token.toLowerCase()
    )
      return false;
    return (
      (
        await mediaRows(
          client,
          `SELECT $1::timestamptz > clock_timestamp() AS current`,
          [row["lease_expires_at"]],
        )
      )[0]?.["current"] === true
    );
  }
  async function canonicalCommand(row: MediaRow) {
    const command = await loadMediaCommand(client, {
      sourceAssetId: row["source_asset_id"],
      metadataRevisionId: row["source_metadata_revision_id"],
      role: row["role"],
      fit: row["fit"],
    });
    return command !== undefined &&
      hashMediaProcessingCommand(command) === row["command_hash"]
      ? command
      : undefined;
  }
  async function finishAttempt(
    row: MediaRow,
    status: "FAILED" | "EXPIRED" | "SUCCEEDED",
    error?: MediaProcessingError,
  ) {
    await mediaRows(
      client,
      `/* media-processing:finish-attempt */ UPDATE public.media_processing_attempts
      SET status=$3,finished_at=GREATEST(clock_timestamp(),started_at),error_code=$4,error_retryable=$5
      WHERE job_id=$1 AND attempt_number=$2 AND status='PROCESSING' RETURNING job_id`,
      [
        row["id"],
        row["attempt_count"],
        status,
        error?.code ?? null,
        error?.retryable ?? null,
      ],
    );
  }
  async function finishFailure(
    row: MediaRow,
    error: MediaProcessingError,
    retry: boolean,
  ) {
    await mediaRows(
      client,
      `/* media-processing:fail-job */ UPDATE public.media_processing_jobs
      SET status=$2,error_code=$3,error_retryable=$4,
        lease_token=CASE WHEN $2='PENDING' THEN NULL ELSE lease_token END,
        lease_expires_at=CASE WHEN $2='PENDING' THEN NULL ELSE lease_expires_at END,
        next_attempt_at=CASE WHEN $2='PENDING' THEN statement_timestamp()+make_interval(secs=>least(300,power(2,attempt_count)::integer)) ELSE NULL END,
        completed_at=CASE WHEN $2='FAILED' THEN statement_timestamp() ELSE NULL END,updated_at=statement_timestamp()
      WHERE id=$1 RETURNING id`,
      [row["id"], retry ? "PENDING" : "FAILED", error.code, error.retryable],
    );
  }
  return {
    enqueue(input) {
      const parsed = mediaProcessingEnqueueCommandSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(failure("INVALID_COMMAND"));
      return run(async () => {
        const request = parsed.data;
        const command = await loadMediaCommand(client, request);
        if (command === undefined) return failure("SOURCE_NOT_ELIGIBLE");
        const hash = hashMediaProcessingCommand(command);
        const previous = await loadMediaJob(client, request.jobId, true);
        if (previous !== undefined)
          return Number(previous["generation"] ?? 1) === 1 &&
            previous["command_hash"] === hash &&
            previous["requested_by"] === request.requestedBy.toLowerCase() &&
            previous["reason"] === request.reason
            ? mediaSnapshot(previous)
            : failure("CONFLICT");
        await mediaRows(
          client,
          `/* media-processing:enqueue */ INSERT INTO public.media_processing_jobs
          (id,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,requested_by,reason,status,next_attempt_at)
          VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,'PENDING',statement_timestamp()) ON CONFLICT DO NOTHING RETURNING id`,
          [
            request.jobId,
            command.source.assetId,
            command.source.metadataRevisionId,
            command.source.checksumSha256,
            command.role,
            command.fit,
            command.focalPoint.x,
            command.focalPoint.y,
            hash,
            request.requestedBy,
            request.reason,
          ],
        );
        const jobs = await mediaRows(
          client,
          // JSON projection reads the additive column while retaining the historical 0012 adapter contract.
          `SELECT * FROM public.media_processing_jobs job WHERE id=$1::uuid OR (command_hash=$2 AND coalesce((to_jsonb(job)->>'generation')::integer,1)=1) ORDER BY id`,
          [request.jobId, hash],
        );
        const exactId = jobs.find(
          (row) => row["id"] === request.jobId.toLowerCase(),
        );
        if (
          exactId !== undefined &&
          (exactId["command_hash"] !== hash ||
            exactId["requested_by"] !== request.requestedBy.toLowerCase() ||
            exactId["reason"] !== request.reason)
        )
          return failure("CONFLICT");
        const job = exactId ?? jobs.find((row) => row["command_hash"] === hash);
        return job === undefined ? failure("UNAVAILABLE") : mediaSnapshot(job);
      });
    },
    read(input) {
      const parsed = mediaProcessingReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => snapshot(parsed.data.jobId))
        : Promise.resolve(failure("INVALID_COMMAND"));
    },
    claim(input) {
      const parsed = mediaProcessingClaimCommandSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(failure("INVALID_COMMAND"));
      return run(async (): Promise<MediaProcessingClaimResponse> => {
        const { leaseToken, leaseSeconds } = parsed.data;
        if (
          (
            await mediaRows(
              client,
              `SELECT job_id FROM public.media_processing_attempts WHERE lease_token=$1::uuid`,
              [leaseToken],
            )
          ).length > 0
        )
          return failure("CONFLICT");
        const exhausted = await mediaRows(
          client,
          `/* media-processing:expired-final-claims */ SELECT * FROM public.media_processing_jobs
          WHERE status='PROCESSING' AND attempt_count=6 AND lease_expires_at<=statement_timestamp()
          ORDER BY lease_expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        );
        for (const row of exhausted) {
          await finishAttempt(row, "EXPIRED", timeoutError);
          await finishFailure(row, timeoutError, false);
        }
        const row = (
          await mediaRows(
            client,
            `/* media-processing:claim-candidate */ SELECT * FROM public.media_processing_jobs
          WHERE (status='PENDING' AND next_attempt_at<=statement_timestamp())
            OR (status='PROCESSING' AND attempt_count<6 AND lease_expires_at<=statement_timestamp())
          ORDER BY coalesce(next_attempt_at,lease_expires_at),id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          )
        )[0];
        if (row === undefined) return { schemaVersion: 1, outcome: "EMPTY" };
        if (row["status"] === "PROCESSING")
          await finishAttempt(row, "EXPIRED", timeoutError);
        const command = await canonicalCommand(row);
        if (command === undefined) {
          await finishFailure(
            row,
            { code: "SOURCE_CHANGED", retryable: false },
            false,
          );
          return { schemaVersion: 1, outcome: "EMPTY" };
        }
        const claimed = (
          await mediaRows(
            client,
            `/* media-processing:claim-job */ UPDATE public.media_processing_jobs
          SET status='PROCESSING',attempt_count=attempt_count+1,lease_token=$2,
            lease_expires_at=statement_timestamp()+make_interval(secs=>$3),next_attempt_at=NULL,
            error_code=NULL,error_retryable=NULL,updated_at=statement_timestamp()
          WHERE id=$1 RETURNING *`,
            [row["id"], leaseToken, leaseSeconds],
          )
        )[0];
        if (claimed === undefined) throw new Error("Claimed media job missing");
        await mediaRows(
          client,
          `/* media-processing:begin-attempt */ INSERT INTO public.media_processing_attempts
          (job_id,attempt_number,lease_token,status,started_at,lease_expires_at)
            SELECT id,attempt_count,lease_token,'PROCESSING',statement_timestamp(),lease_expires_at
              FROM public.media_processing_jobs WHERE id=$1 RETURNING job_id`,
          [claimed["id"]],
        );
        return mediaProcessingClaimResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          value: {
            schemaVersion: 1,
            jobId: claimed["id"],
            leaseToken: claimed["lease_token"],
            attempt: claimed["attempt_count"],
            leaseExpiresAt: mediaTimestamp(claimed["lease_expires_at"]),
            command,
          },
        });
      });
    },
    complete(input) {
      const parsed = mediaProcessingCompleteCommandSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(failure("INVALID_COMMAND"));
      return run(async () => {
        const { jobId, leaseToken, result } = parsed.data;
        const row = await loadMediaJob(client, jobId, true);
        if (row === undefined) return failure("NOT_FOUND");
        const receiptHash = mediaReceiptHash(result);
        if (row["status"] === "SUCCEEDED")
          return row["lease_token"] === leaseToken.toLowerCase() &&
            row["result_hash"] === receiptHash
            ? mediaSnapshot(row)
            : failure("CONFLICT");
        if (!(await currentLease(row, leaseToken)))
          return failure("STALE_CLAIM");
        const command = await canonicalCommand(row);
        if (command === undefined) return failure("SOURCE_NOT_ELIGIBLE");
        if (!validateMediaProcessingReceipt(command, result))
          return failure("CONFLICT");
        const assetId = await persistMediaOutputs(
          client,
          jobId,
          command.source.assetId,
          result,
        );
        await finishAttempt(row, "SUCCEEDED");
        await mediaRows(
          client,
          `/* media-processing:complete-job */ UPDATE public.media_processing_jobs
          SET status='SUCCEEDED',output_asset_id=$2,result_hash=$3,orientation=$4,error_code=NULL,error_retryable=NULL,
            completed_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=$1 RETURNING id`,
          [jobId, assetId, receiptHash, result.orientation],
        );
        return snapshot(jobId);
      });
    },
    fail(input) {
      const parsed = mediaProcessingFailCommandSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(failure("INVALID_COMMAND"));
      return run(async () => {
        const { jobId, leaseToken, error } = parsed.data;
        const row = await loadMediaJob(client, jobId, true);
        if (row === undefined) return failure("NOT_FOUND");
        if (!(await currentLease(row, leaseToken))) {
          const prior = (
            await mediaRows(
              client,
              `SELECT status,error_code,error_retryable FROM public.media_processing_attempts
            WHERE job_id=$1 AND lease_token=$2 AND attempt_number=$3`,
              [jobId, leaseToken, row["attempt_count"]],
            )
          )[0];
          return ["PENDING", "FAILED"].includes(String(row["status"])) &&
            prior?.["status"] === "FAILED" &&
            prior["error_code"] === error.code &&
            prior["error_retryable"] === error.retryable
            ? mediaSnapshot(row)
            : failure("STALE_CLAIM");
        }
        await finishAttempt(row, "FAILED", error);
        await finishFailure(
          row,
          error,
          error.retryable && Number(row["attempt_count"]) < 6,
        );
        return snapshot(jobId);
      });
    },
  };
}
