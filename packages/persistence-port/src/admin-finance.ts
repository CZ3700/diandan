import type {
  AdminFinanceStoreRequest,
  AdminFinanceResponse,
  AdminFinanceClaimRequest,
  AdminFinanceClaim,
  AdminFinanceSettleCommand,
  AdminFinanceSettleResult,
  AdminFinanceApplyCommand,
  AdminFinanceApplyResult,
  AdminFinanceListPendingCommand,
  AdminFinancePendingEvents,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
/** The same-client transaction owns authorization, capacity and durable receipts. External calls never occur here. */
export interface AdminFinanceRepository {
  execute(request: AdminFinanceStoreRequest): Promise<AdminFinanceResponse>;
  claim(command: AdminFinanceClaimRequest): Promise<AdminFinanceClaim | null>;
  settle(command: AdminFinanceSettleCommand): Promise<AdminFinanceSettleResult>;
  apply(command: AdminFinanceApplyCommand): Promise<AdminFinanceApplyResult>;
  listPending(
    command: AdminFinanceListPendingCommand,
  ): Promise<AdminFinancePendingEvents>;
}
export interface AdminFinanceTransactionManager {
  runInAdminFinanceTransaction<Result extends JsonValue>(
    work: (repository: AdminFinanceRepository) => Promise<Result>,
  ): Promise<Result>;
}
