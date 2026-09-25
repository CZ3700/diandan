import {
  persistencePortCommandSchema,
  persistencePortResponseSchema,
  type PersistencePortCommand,
  type PersistencePortError,
  type PersistencePortFailure,
  type PersistencePortResponse,
} from "@fan-support/persistence-port";

import { classifyPostgresFailure } from "./errors.js";

type PersistenceOperation = PersistencePortCommand["operation"];
type ResponseFor<Operation extends PersistenceOperation> = Extract<
  PersistencePortResponse,
  { operation: Operation }
>;

const retryDelayMs = 250;

export function parseRepositoryCommand<
  Operation extends PersistenceOperation,
  Command extends Extract<PersistencePortCommand, { operation: Operation }>,
>(command: unknown, operation: Operation): Command | undefined {
  const parsed = persistencePortCommandSchema.safeParse(command);
  if (!parsed.success || parsed.data.operation !== operation) {
    return undefined;
  }
  return parsed.data as Command;
}

export function repositorySuccess<Operation extends PersistenceOperation>(
  operation: Operation,
  value: unknown,
): ResponseFor<Operation> {
  return persistencePortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  }) as ResponseFor<Operation>;
}

export function repositoryFailure<Operation extends PersistenceOperation>(
  operation: Operation,
  code: PersistencePortError["code"],
): PersistencePortFailure & Readonly<{ operation: Operation }> {
  const retryable =
    code === "TRANSACTION_ABORTED" ||
    code === "TEMPORARY_UNAVAILABLE" ||
    code === "UNEXPECTED_ADAPTER_FAILURE";
  const requiresReconciliation = code === "TRANSACTION_OUTCOME_UNKNOWN";
  return persistencePortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: requiresReconciliation
        ? "RECONCILE_REQUIRED"
        : retryable
          ? "RETRY_SAME_COMMAND"
          : "NONE",
      ...(retryable ? { retryAfterMs: retryDelayMs } : {}),
    },
  }) as PersistencePortFailure & Readonly<{ operation: Operation }>;
}

export function repositoryDatabaseFailure<
  Operation extends PersistenceOperation,
>(
  operation: Operation,
  error: unknown,
): PersistencePortFailure & Readonly<{ operation: Operation }> {
  return repositoryFailure(operation, classifyPostgresFailure(error).code);
}
