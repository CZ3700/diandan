import {
  publicationPurgeClaimResponseSchema,
  publicationPurgeRecordResponseSchema,
  cachePurgePortResponseSchema,
  type PublicationPurgeClaim,
  type PublicationPurgeRecordCommand,
  type PublicationPurgeRunResult,
  type PublicationPurgeJob,
} from "@fan-support/contracts";
import type { CachePurgePort } from "@fan-support/cache-purge-port";
import type {
  JsonValue,
  PublicationPurgeTransactionManager,
} from "@fan-support/persistence-port";
import { compareBaseContentTime } from "./base-content-time.js";

export type PublicationPurgeDependencies = Readonly<{
  transactions: PublicationPurgeTransactionManager;
  cachePurge: CachePurgePort;
}>;
export type PublicationPurgeUseCases = Readonly<{
  processNext(): Promise<PublicationPurgeRunResult>;
}>;
type Result = PublicationPurgeRecordCommand["result"];
function matchesRecordedResult(
  claim: PublicationPurgeClaim,
  result: Result,
  job: PublicationPurgeJob,
): boolean {
  for (const field of [
    "id",
    "publicationId",
    "outboxEventId",
    "retryOf",
  ] as const)
    if (job[field]?.toLowerCase() !== claim.job[field]?.toLowerCase())
      return false;
  if (
    job.version !== claim.version + 1 ||
    job.locale !== claim.job.locale ||
    job.generation !== claim.job.generation ||
    job.attemptCount !== claim.job.attemptCount ||
    compareBaseContentTime(job.createdAt, claim.job.createdAt) !== 0
  )
    return false;
  // The database may reach its absolute deadline while a provider request is in flight.
  if (job.status === "FAILED" && job.errorCode === "PURGE_TIMEOUT") return true;
  switch (result.kind) {
    case "COMPLETED":
      return job.status === "COMPLETED";
    case "SUBMITTED":
    case "PENDING":
      return job.status === "SUBMITTED";
    case "FAILURE":
      return (
        (job.status === claim.job.status || job.status === "FAILED") &&
        job.failureCount === claim.job.failureCount + 1 &&
        job.errorCode === result.code
      );
  }
}
async function boundedProviderCall<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("purge provider deadline exceeded")),
          30_000,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function dispatch(
  cachePurge: CachePurgePort,
  claim: PublicationPurgeClaim,
): Promise<Result> {
  try {
    const isPoll = claim.purgeReference !== null;
    const raw = await boundedProviderCall<unknown>(() =>
      isPoll
        ? cachePurge.getPurgeStatus({
            schemaVersion: 1,
            operation: "GET_PURGE_STATUS",
            purgeReference: claim.purgeReference!,
          })
        : cachePurge.submitPurge({
            schemaVersion: 1,
            operation: "SUBMIT_PURGE",
            idempotencyKey: claim.idempotencyKey,
            paths: claim.paths,
          }),
    );
    const parsed = cachePurgePortResponseSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.operation !== (isPoll ? "GET_PURGE_STATUS" : "SUBMIT_PURGE")
    )
      return {
        kind: "FAILURE",
        code: "INVALID_PROVIDER_RESPONSE",
        retryable: false,
      };
    const response = parsed.data;
    if (response.outcome === "FAILURE")
      return {
        kind: "FAILURE",
        code: response.error.code,
        retryable: response.error.recovery === "RETRY_SAME_COMMAND",
      };
    if (isPoll && response.value.purgeReference !== claim.purgeReference)
      return {
        kind: "FAILURE",
        code: "INVALID_PROVIDER_RESPONSE",
        retryable: false,
      };
    if (response.value.status === "COMPLETED")
      return {
        kind: "COMPLETED",
        purgeReference: response.value.purgeReference,
      };
    return isPoll
      ? { kind: "PENDING" }
      : { kind: "SUBMITTED", purgeReference: response.value.purgeReference };
  } catch {
    return {
      kind: "FAILURE",
      code: "UNEXPECTED_ADAPTER_FAILURE",
      retryable: true,
    };
  }
}
/** A durable content-specific claim is the only source of paths and submission identity. */
export function createPublicationPurgeUseCases(
  dependencies: PublicationPurgeDependencies,
): PublicationPurgeUseCases {
  return Object.freeze({
    async processNext(): Promise<PublicationPurgeRunResult> {
      try {
        const claimed = publicationPurgeClaimResponseSchema.parse(
          await dependencies.transactions.runInPublicationPurgeTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  await repositories.publicationPurge.claim({
                    schemaVersion: 1,
                    leaseSeconds: 60,
                  }),
                ),
              ) as JsonValue,
          ),
        );
        if (claimed.outcome !== "SUCCESS")
          return { schemaVersion: 1, outcome: "UNAVAILABLE" };
        if (claimed.claim === null)
          return { schemaVersion: 1, outcome: "IDLE" };
        const claim = claimed.claim;
        const result = await dispatch(dependencies.cachePurge, claim);
        const recorded = publicationPurgeRecordResponseSchema.parse(
          await dependencies.transactions.runInPublicationPurgeTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  await repositories.publicationPurge.record({
                    schemaVersion: 1,
                    jobId: claim.job.id,
                    leaseToken: claim.leaseToken,
                    expectedVersion: claim.version,
                    result,
                  }),
                ),
              ) as JsonValue,
          ),
        );
        if (
          recorded.outcome !== "SUCCESS" ||
          !matchesRecordedResult(claim, result, recorded.job)
        )
          return { schemaVersion: 1, outcome: "UNAVAILABLE" };
        return {
          schemaVersion: 1,
          outcome: "RECORDED",
          jobId: recorded.job.id,
          status: recorded.job.status,
        };
      } catch {
        return { schemaVersion: 1, outcome: "UNAVAILABLE" };
      }
    },
  });
}
