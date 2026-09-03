import {
  listReadyOutboxEventsCommandSchema,
  listReadyOutboxEventsResponseSchema,
  purgeExpiredWebhookPayloadsCommandSchema,
  purgeExpiredWebhookPayloadsResponseSchema,
  type OutboxDispatchJob,
  type PurgeExpiredWebhookPayloadsResponse,
} from "@fan-support/contracts";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import { ReliableEventProcessingError } from "./process-webhook-inbox.js";
export { ReliableEventProcessingError } from "./process-webhook-inbox.js";

export type ReliableEventMaintenanceDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
}>;

function persistenceFailure(): ReliableEventProcessingError {
  return new ReliableEventProcessingError("PERSISTENCE_FAILURE");
}

export function createListReadyOutboxJobs(
  dependencies: ReliableEventMaintenanceDependencies,
): (command: unknown) => Promise<readonly OutboxDispatchJob[]> {
  return async (command) => {
    const parsedCommand = listReadyOutboxEventsCommandSchema.safeParse(command);
    if (!parsedCommand.success) {
      throw new ReliableEventProcessingError("INVALID_JOB");
    }
    try {
      return await dependencies.transactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          const result = await repositories.outboxDispatch.listReady(
            parsedCommand.data,
          );
          const parsed = listReadyOutboxEventsResponseSchema.safeParse(result);
          if (!parsed.success) {
            throw persistenceFailure();
          }
          return parsed.data.value.jobs;
        },
      );
    } catch (error: unknown) {
      if (error instanceof ReliableEventProcessingError) {
        throw error;
      }
      throw persistenceFailure();
    }
  };
}

type PurgeResult = PurgeExpiredWebhookPayloadsResponse["value"];

export function createPurgeExpiredWebhookPayloads(
  dependencies: ReliableEventMaintenanceDependencies,
): (command: unknown) => Promise<PurgeResult> {
  return async (command) => {
    const parsedCommand =
      purgeExpiredWebhookPayloadsCommandSchema.safeParse(command);
    if (!parsedCommand.success) {
      throw new ReliableEventProcessingError("INVALID_JOB");
    }
    try {
      return await dependencies.transactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          const result =
            await repositories.webhookPayloadRetention.purgeExpired(
              parsedCommand.data,
            );
          const parsed =
            purgeExpiredWebhookPayloadsResponseSchema.safeParse(result);
          if (!parsed.success) {
            throw persistenceFailure();
          }
          return parsed.data.value;
        },
      );
    } catch (error: unknown) {
      if (error instanceof ReliableEventProcessingError) {
        throw error;
      }
      throw persistenceFailure();
    }
  };
}
