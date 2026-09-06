import { validateMediaProcessingReceipt } from "@fan-support/content";
import {
  mediaImageProcessingResultSchema,
  mediaProcessingClaimCommandSchema,
  mediaProcessingClaimResponseSchema,
  mediaProcessingSnapshotResponseSchema,
  type MediaImageProcessingResult,
  type MediaProcessingClaim,
  type MediaProcessingRunResult,
} from "@fan-support/contracts";
import type { MediaImageProcessingPort } from "@fan-support/media-port";
import type { MediaProcessingTransactionManager } from "@fan-support/persistence-port";

export type MediaProcessingDependencies = Readonly<{
  transactions: MediaProcessingTransactionManager;
  processor: MediaImageProcessingPort;
  createLeaseToken(): string;
  leaseSeconds: number;
}>;

export type MediaProcessingUseCases = Readonly<{
  processNext(): Promise<MediaProcessingRunResult>;
}>;

function result(
  outcome: MediaProcessingRunResult["outcome"],
): MediaProcessingRunResult {
  return { schemaVersion: 1, outcome };
}

async function processClaim(
  claim: MediaProcessingClaim,
  processor: MediaImageProcessingPort,
): Promise<MediaImageProcessingResult> {
  try {
    const receipt = mediaImageProcessingResultSchema.parse(
      await processor.process(claim.command),
    );
    if (
      receipt.outcome === "SUCCESS" &&
      !validateMediaProcessingReceipt(claim.command, receipt)
    ) {
      throw new Error("Invalid media processing receipt");
    }
    return receipt;
  } catch {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "UNEXPECTED_PROCESSING_FAILURE", retryable: true },
    };
  }
}

export function createMediaProcessingUseCases(
  dependencies: MediaProcessingDependencies,
): MediaProcessingUseCases {
  return Object.freeze({
    async processNext(): Promise<MediaProcessingRunResult> {
      try {
        const command = mediaProcessingClaimCommandSchema.parse({
          schemaVersion: 1,
          leaseToken: dependencies.createLeaseToken(),
          leaseSeconds: dependencies.leaseSeconds,
        });
        const claimed = mediaProcessingClaimResponseSchema.parse(
          await dependencies.transactions.runInMediaProcessingTransaction(
            async ({ mediaProcessing }) => mediaProcessing.claim(command),
          ),
        );
        if (claimed.outcome === "EMPTY") return result("EMPTY");
        if (
          claimed.outcome !== "SUCCESS" ||
          claimed.value.leaseToken.toLowerCase() !==
            command.leaseToken.toLowerCase()
        )
          return result("UNAVAILABLE");
        const claim = claimed.value;
        const processed = await processClaim(claim, dependencies.processor);
        // Never hold a transaction while reading, transforming or writing bytes.
        // An uncertain commit is left leased: a retry must use the durable fence.
        const finalized = mediaProcessingSnapshotResponseSchema.parse(
          await dependencies.transactions.runInMediaProcessingTransaction(
            async ({ mediaProcessing }) =>
              processed.outcome === "SUCCESS"
                ? mediaProcessing.complete({
                    schemaVersion: 1,
                    jobId: claim.jobId,
                    leaseToken: claim.leaseToken,
                    result: processed,
                  })
                : mediaProcessing.fail({
                    schemaVersion: 1,
                    jobId: claim.jobId,
                    leaseToken: claim.leaseToken,
                    error: processed.error,
                  }),
          ),
        );
        if (finalized.outcome === "FAILURE")
          return result(
            finalized.code === "STALE_CLAIM" ? "STALE_CLAIM" : "UNAVAILABLE",
          );
        const snapshot = finalized.value;
        if (
          snapshot.jobId.toLowerCase() !== claim.jobId.toLowerCase() ||
          snapshot.attemptCount !== claim.attempt
        )
          return result("UNAVAILABLE");
        if (processed.outcome === "SUCCESS")
          return result(
            snapshot.status === "SUCCEEDED" ? "SUCCEEDED" : "UNAVAILABLE",
          );
        if (snapshot.status === "FAILED") return result("FAILED");
        if (
          snapshot.status === "PENDING" &&
          processed.error.retryable &&
          snapshot.nextAttemptAt !== null
        )
          return result("RETRY_SCHEDULED");
        return result("UNAVAILABLE");
      } catch {
        return result("UNAVAILABLE");
      }
    },
  });
}
