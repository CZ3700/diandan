import { createHash, randomUUID } from "node:crypto";
import {
  notificationEmailDispatchSchema,
  notificationPortResponseSchema,
  notificationSubmissionClaimCommandSchema,
  notificationSubmissionClaimResultSchema,
  notificationSubmissionDefiniteResultSchema,
  notificationSubmissionFinishCommandSchema,
  notificationSubmissionFinishResultSchema,
  sourceHashSchema,
  type NotificationEmailDispatch,
  type SendNotificationResponse,
} from "@fan-support/contracts";
import type {
  NotificationEmailSubmitter,
  NotificationEmailTransport,
} from "@fan-support/notification-port";
import type {
  JsonValue,
  NotificationSubmissionTransactionManager,
} from "@fan-support/persistence-port";

export type DurableNotificationTransportOptions = Readonly<{
  transportKey: string;
  transactions: NotificationSubmissionTransactionManager;
  submitter: NotificationEmailSubmitter;
  createId?: () => string;
}>;

function failure(
  code:
    | "INVALID_COMMAND"
    | "IDEMPOTENCY_CONFLICT"
    | "CONFIGURATION_ERROR"
    | "TIMEOUT_OUTCOME_UNKNOWN"
    | "MALFORMED_PROVIDER_RESPONSE",
): SendNotificationResponse {
  const retry =
    code === "TIMEOUT_OUTCOME_UNKNOWN" ||
    code === "MALFORMED_PROVIDER_RESPONSE";
  return notificationPortResponseSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: retry ? "RETRY_SAME_COMMAND" : "NONE",
      ...(retry ? { retryAfterMs: 1000 } : {}),
    },
  });
}

/** Turns a non-idempotent provider into a replayable transport without repeating uncertain sends. */
export function createDurableNotificationTransport(
  options: DurableNotificationTransportOptions,
): NotificationEmailTransport {
  const transportKey = sourceHashSchema.parse(options.transportKey);
  const { transactions, submitter } = options;
  const createId = options.createId ?? randomUUID;
  if (
    typeof transactions?.runInNotificationSubmissionTransaction !==
      "function" ||
    typeof submitter?.sendEmail !== "function"
  )
    throw new TypeError("Invalid durable notification transport configuration");

  return Object.freeze({
    async sendEmail(input: NotificationEmailDispatch) {
      const parsed = notificationEmailDispatchSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      const email = parsed.data;
      try {
        const command = notificationSubmissionClaimCommandSchema.parse({
          schemaVersion: 1,
          transportKey,
          notificationId: email.notification.id,
          idempotencyKey: email.notification.idempotencyKey,
          requestHash: createHash("sha256")
            .update(JSON.stringify(email))
            .digest("hex"),
          dispatchNotAfter: email.dispatchNotAfter,
          claimToken: createId(),
        });
        // This promise includes COMMIT; neither network I/O nor plaintext belongs in the transaction.
        const claim = notificationSubmissionClaimResultSchema.parse(
          await transactions.runInNotificationSubmissionTransaction(
            async (repo) =>
              JSON.parse(
                JSON.stringify(await repo.claim(command)),
              ) as JsonValue,
          ),
        );
        if (claim.decision === "REPLAY") return claim.result;
        if (claim.decision === "CONFLICT")
          return failure("IDEMPOTENCY_CONFLICT");
        if (claim.decision === "EXPIRED") return failure("CONFIGURATION_ERROR");
        if (claim.decision === "UNKNOWN")
          return failure("TIMEOUT_OUTCOME_UNKNOWN");

        const response = notificationPortResponseSchema.safeParse(
          await submitter.sendEmail(email),
        );
        if (!response.success) return failure("MALFORMED_PROVIDER_RESPONSE");
        const definite = notificationSubmissionDefiniteResultSchema.safeParse(
          response.data,
        );
        // Keeping the admitted row unresolved is intentional: a retry can only read it, never POST again.
        if (!definite.success) return response.data;
        const finished = notificationSubmissionFinishResultSchema.parse(
          await transactions.runInNotificationSubmissionTransaction((repo) =>
            repo.finish(
              notificationSubmissionFinishCommandSchema.parse({
                ...command,
                result: definite.data,
              }),
            ),
          ),
        );
        return finished.decision === "CONFLICT"
          ? failure("TIMEOUT_OUTCOME_UNKNOWN")
          : definite.data;
      } catch {
        // A lost claim/receipt COMMIT is uncertain too. Never retry the provider from this catch.
        return failure("TIMEOUT_OUTCOME_UNKNOWN");
      }
    },
  });
}
