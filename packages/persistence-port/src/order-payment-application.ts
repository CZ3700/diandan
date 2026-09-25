import type {
  OrderPaymentApplyCommand,
  OrderPaymentApplyResult,
  OrderPaymentListPendingCommand,
  OrderPaymentPendingEvents,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface OrderPaymentApplicationRepository {
  /** Re-reads trusted evidence and applies the existing aggregate atomically on the caller's client. */
  apply(command: OrderPaymentApplyCommand): Promise<OrderPaymentApplyResult>;
  /** Only durable observations without a final receipt; unmatched observations remain recoverable. */
  listPending(
    command: OrderPaymentListPendingCommand,
  ): Promise<OrderPaymentPendingEvents>;
}
export interface OrderPaymentApplicationTransactionManager {
  runInOrderPaymentApplicationTransaction<Result extends JsonValue>(
    work: (repository: OrderPaymentApplicationRepository) => Promise<Result>,
  ): Promise<Result>;
}
