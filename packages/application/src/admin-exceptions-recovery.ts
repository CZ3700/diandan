import { randomBytes, randomUUID } from "node:crypto";
import {
  adminExceptionsClaimRequestSchema,
  adminExceptionsClaimSchema,
  adminExceptionsRunResultSchema,
  adminExceptionsSettleCommandSchema,
  adminExceptionsSettleResultSchema,
  type AdminExceptionsClaim,
  type OutboxDispatchJob,
  type ReliableEventDeliveryContext,
  type WebhookInboxJob,
} from "@fan-support/contracts";
import type { AdminExceptionsTransactionManager } from "@fan-support/persistence-port";

export type AdminExceptionsRecoveryDependencies = Readonly<{
  transactions: AdminExceptionsTransactionManager;
  processWebhookInbox(
    job: WebhookInboxJob,
    delivery: ReliableEventDeliveryContext,
  ): Promise<void>;
  dispatchOutboxEvent(
    job: OutboxDispatchJob,
    delivery: ReliableEventDeliveryContext,
  ): Promise<void>;
  leaseMs?: number;
}>;
/** An operator authorizes one bounded processing attempt. Crash recovery repeats the same durable source. */
export function createAdminExceptionsRecovery(
  dependencies: AdminExceptionsRecoveryDependencies,
) {
  const leaseMs = dependencies.leaseMs ?? 30000;
  if (
    !Number.isInteger(leaseMs) ||
    leaseMs < 1000 ||
    leaseMs > 300000 ||
    typeof dependencies.transactions?.runInAdminExceptionsTransaction !==
      "function" ||
    typeof dependencies.processWebhookInbox !== "function" ||
    typeof dependencies.dispatchOutboxEvent !== "function"
  )
    throw new TypeError("Invalid exception recovery configuration");
  async function execute(claim: AdminExceptionsClaim) {
    let outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
    try {
      const delivery = {
        schemaVersion: 1,
        jobId: claim.operationId,
        attemptNumber: 6,
        maxAttempts: 6,
      } as const;
      if (claim.job.jobType === "PROCESS_WEBHOOK_INBOX")
        await dependencies.processWebhookInbox(claim.job, delivery);
      else if (claim.job.consumerKey === "order-notifications-v1")
        await dependencies.dispatchOutboxEvent(claim.job, delivery);
      else throw new TypeError("Unsupported exception consumer");
    } catch {
      outcome = "FAILED";
    }
    const settled =
      await dependencies.transactions.runInAdminExceptionsTransaction(
        async (repository) =>
          adminExceptionsSettleResultSchema.parse(
            await repository.settle(
              adminExceptionsSettleCommandSchema.parse({
                schemaVersion: 1,
                claim,
                outcome,
                reasonCode:
                  outcome === "SUCCEEDED" ? "PROCESSED" : "PROCESSING_FAILED",
              }),
            ),
          ),
      );
    if (settled.operationId !== claim.operationId)
      throw new TypeError("Mismatched exception settlement");
    return settled.decision === "RECORDED" && outcome === "SUCCEEDED";
  }
  return Object.freeze({
    async runPending(limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new TypeError("Invalid exception recovery batch");
      const result = {
        schemaVersion: 1 as const,
        scanned: 0,
        succeeded: 0,
        failed: 0,
      };
      for (let index = 0; index < limit; index++) {
        const claimed =
          await dependencies.transactions.runInAdminExceptionsTransaction(
            async (repository) => {
              const request = adminExceptionsClaimRequestSchema.parse({
                schemaVersion: 1,
                operationId: null,
                requestId: randomUUID(),
                correlationId: randomUUID(),
                leaseTokenDigest: randomBytes(32).toString("hex"),
                leaseDurationMs: leaseMs,
              });
              const value = await repository.claim(request);
              if (value === null) return null;
              const parsed = adminExceptionsClaimSchema.parse(value);
              if (parsed.leaseTokenDigest !== request.leaseTokenDigest)
                throw new TypeError("Mismatched exception lease");
              return parsed;
            },
          );
        if (claimed === null) break;
        result.scanned++;
        try {
          if (await execute(claimed)) result.succeeded++;
          else result.failed++;
        } catch {
          result.failed++;
        }
      }
      return adminExceptionsRunResultSchema.parse(result);
    },
  });
}
