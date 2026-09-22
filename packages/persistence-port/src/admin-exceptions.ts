import type {
  AdminExceptionsStoreRequest,
  AdminExceptionsResponse,
  AdminExceptionsClaimRequest,
  AdminExceptionsClaim,
  AdminExceptionsSettleCommand,
  AdminExceptionsSettleResult,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface AdminExceptionsRepository {
  execute(
    request: AdminExceptionsStoreRequest,
  ): Promise<AdminExceptionsResponse>;
  claim(
    request: AdminExceptionsClaimRequest,
  ): Promise<AdminExceptionsClaim | null>;
  settle(
    command: AdminExceptionsSettleCommand,
  ): Promise<AdminExceptionsSettleResult>;
}
export interface AdminExceptionsTransactionManager {
  runInAdminExceptionsTransaction<Result extends JsonValue>(
    work: (repository: AdminExceptionsRepository) => Promise<Result>,
  ): Promise<Result>;
}
