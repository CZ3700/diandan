import {
  adminExceptionsStoreRequestSchema,
  adminExceptionsClaimRequestSchema,
  adminExceptionsSettleCommandSchema,
} from "@fan-support/contracts";
import type {
  AdminExceptionsRepository,
  AdminFinanceRepository,
  AdminOrderResendRepository,
} from "@fan-support/persistence-port";
import { executeExceptions } from "./admin-exceptions-command.js";
import {
  claimException,
  settleException,
} from "./admin-exceptions-recovery.js";
import { exceptionFailure } from "./admin-exceptions-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createAdminExceptionsRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  finance: AdminFinanceRepository,
  resends: AdminOrderResendRepository,
): AdminExceptionsRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    execute: (input) =>
      run(async () => {
        const p = adminExceptionsStoreRequestSchema.safeParse(input);
        return p.success
          ? executeExceptions(client, p.data, finance, resends)
          : exceptionFailure("INVALID_COMMAND");
      }),
    claim: (input) =>
      run(() =>
        claimException(client, adminExceptionsClaimRequestSchema.parse(input)),
      ),
    settle: (input) =>
      run(() =>
        settleException(
          client,
          adminExceptionsSettleCommandSchema.parse(input),
        ),
      ),
  };
}
