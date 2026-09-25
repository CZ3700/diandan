import {
  publicationPreflightCommandSchema,
  publicationRuntimeWriteCommandSchema,
  publicationRuntimeReceiptReadCommandSchema,
  publicationStatusCommandSchema,
  publicationRuntimeRetryWriteCommandSchema,
} from "@fan-support/contracts";
import type { PublicationRuntimeRepository } from "@fan-support/persistence-port";
import { baseContentFailure } from "./base-content-data.js";
import { createResourceRun } from "./resource-management-data.js";
import { loadPublicationRuntime } from "./publication-runtime-load.js";
import { writePublicationRuntime } from "./publication-runtime-write.js";
import {
  readPublicationReceipt,
  readPublicationStatus,
} from "./publication-runtime-data.js";
import { retryPublicationPurge } from "./publication-runtime-retry.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

/** Transaction-scoped publication operations; Application owns authorization and idempotency orchestration. */
export function createPublicationRuntimeRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): PublicationRuntimeRepository {
  const run = createResourceRun(client, scope),
    invalid = () =>
      scope.trackOperation(async () => baseContentFailure("INVALID_COMMAND"));
  return {
    load(input) {
      const parsed = publicationPreflightCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => loadPublicationRuntime(client, scope, parsed.data))
        : invalid();
    },
    write(input) {
      const parsed = publicationRuntimeWriteCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => writePublicationRuntime(client, scope, parsed.data))
        : invalid();
    },
    readReceipt(input) {
      const parsed =
        publicationRuntimeReceiptReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            readPublicationReceipt(
              client,
              parsed.data.resultId,
              parsed.data.actorId,
            ),
          )
        : invalid();
    },
    status(input) {
      const parsed = publicationStatusCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => readPublicationStatus(client, parsed.data))
        : invalid();
    },
    retry(input) {
      const parsed = publicationRuntimeRetryWriteCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => retryPublicationPurge(client, parsed.data))
        : invalid();
    },
  };
}
