import type {
  AdminOrdersConfirmPrivate,
  AdminOrdersFailure,
  AdminOrdersPrivateConfirmation,
  AdminOrdersPrivateSnapshot,
  AdminOrdersResponse,
  AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface AdminOrdersRepository {
  execute(request: AdminOrdersStoreRequest): Promise<AdminOrdersResponse>;
  /** The audit and private-access receipt must commit before callers decrypt. */
  preparePrivate(
    request: AdminOrdersStoreRequest,
  ): Promise<AdminOrdersPrivateSnapshot | AdminOrdersFailure>;
  /** Rechecks current authority, privacy, content version and snapshot membership. */
  confirmPrivate(
    command: AdminOrdersConfirmPrivate,
  ): Promise<AdminOrdersPrivateConfirmation | AdminOrdersFailure>;
}
export interface AdminOrderResendRepository {
  request(request: AdminOrdersStoreRequest): Promise<AdminOrdersResponse>;
}
export type AdminOrdersRepositories = Readonly<{
  adminOrders: AdminOrdersRepository;
  adminOrderResends: AdminOrderResendRepository;
}>;
export interface AdminOrdersTransactionManager {
  runInAdminOrdersTransaction<Result extends JsonValue>(
    work: (repositories: AdminOrdersRepositories) => Promise<Result>,
  ): Promise<Result>;
}
