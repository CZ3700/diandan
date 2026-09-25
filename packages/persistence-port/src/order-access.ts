import type {
  OrderAccessIssueCommand,
  OrderAccessExchangeCommand,
  OrderAccessBootstrapCommand,
  OrderAccessReadCommand,
  OrderAccessRevokeCommand,
  OrderAccessGrant,
  OrderAccessRevoked,
  OrderAccessDetail,
  OrderAccessFailureCode,
  OrderAccessRateCommand,
  OrderAccessRateResult,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export class OrderAccessRepositoryError extends Error {
  constructor(readonly code: OrderAccessFailureCode) {
    super("Order access failed");
    this.name = "OrderAccessRepositoryError";
  }
}

export interface OrderAccessRepository {
  issue(command: OrderAccessIssueCommand): Promise<OrderAccessGrant>;
  exchange(command: OrderAccessExchangeCommand): Promise<OrderAccessGrant>;
  bootstrap(command: OrderAccessBootstrapCommand): Promise<OrderAccessGrant>;
  read(command: OrderAccessReadCommand): Promise<OrderAccessDetail>;
  revoke(command: OrderAccessRevokeCommand): Promise<OrderAccessRevoked>;
  consumeRateLimit(
    command: OrderAccessRateCommand,
  ): Promise<OrderAccessRateResult>;
}

export interface OrderAccessTransactionManager {
  /** Uses explicit aggregate locks; a rejected callback must roll back. */
  runInOrderAccessTransaction<Result extends JsonValue>(
    work: (repository: OrderAccessRepository) => Promise<Result>,
  ): Promise<Result>;
}
