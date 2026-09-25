import {
  paymentRuntimeFailureCodeSchema,
  type PaymentRuntimeAttemptRecord,
  type PaymentRuntimeBeginCreateCommand,
  type PaymentRuntimeBeginCreateResult,
  type PaymentRuntimeClaim,
  type PaymentRuntimeClaimRecoveryCommand,
  type PaymentRuntimeContext,
  type PaymentRuntimeCreateReceipt,
  type PaymentRuntimeCurrentCheckout,
  type PaymentRuntimeDeferRecoveryCommand,
  type PaymentRuntimeFailureCode,
  type PaymentRuntimeFindCreateReceiptCommand,
  type PaymentRuntimeLoadContextCommand,
  type PaymentRuntimeLoadCurrentCheckoutCommand,
  type PaymentRuntimeReadAttemptCommand,
  type PaymentRuntimeRecordReconcileCommand,
  type PaymentRuntimeSettleCreateCommand,
} from "@fan-support/contracts";
import type { CartRuntimeRepository } from "./cart-runtime.js";
import type {
  IdempotencyRepository,
  JsonValue,
  OutboxRepository,
} from "./index.js";

export class PaymentRuntimeRepositoryError extends Error {
  readonly code: PaymentRuntimeFailureCode;
  constructor(code: PaymentRuntimeFailureCode) {
    super("Payment runtime rejected");
    this.name = "PaymentRuntimeRepositoryError";
    this.code = paymentRuntimeFailureCodeSchema.parse(code);
  }
}

export interface PaymentRuntimeRepository {
  /** Authenticates the cart/session and loads current published routing plus immutable checkout facts. */
  loadContext(
    command: PaymentRuntimeLoadContextCommand,
  ): Promise<PaymentRuntimeContext>;
  loadCurrentCheckout(
    command: PaymentRuntimeLoadCurrentCheckoutCommand,
  ): Promise<PaymentRuntimeCurrentCheckout | null>;
  /** Permanent receipt is checked before the generic, expiring idempotency cache. */
  findCreateReceipt(
    command: PaymentRuntimeFindCreateReceiptCommand,
  ): Promise<PaymentRuntimeCreateReceipt | null>;
  /** Locks the existing order and valid reservations; writes CREATED, its history/outbox and a fenced recovery claim atomically. Never creates an order. */
  beginCreate(
    command: PaymentRuntimeBeginCreateCommand,
  ): Promise<PaymentRuntimeBeginCreateResult>;
  /** Requires the current unexpired lease generation and exact persisted attempt; a late result never overwrites UNKNOWN or newer evidence. */
  settleCreate(
    command: PaymentRuntimeSettleCreateCommand,
  ): Promise<PaymentRuntimeAttemptRecord>;
  /** A CHECKOUT target reauthorizes its Cookie binding; DUE is internal worker-only. CREATED repeats the frozen create, UNKNOWN only reconciles. */
  claimRecovery(
    command: PaymentRuntimeClaimRecoveryCommand,
  ): Promise<PaymentRuntimeClaim | null>;
  /** Persists actual authenticated evidence/audit. Financial success remains pending the separate aggregate application boundary. */
  recordReconcile(
    command: PaymentRuntimeRecordReconcileCommand,
  ): Promise<PaymentRuntimeAttemptRecord>;
  deferRecovery(
    command: PaymentRuntimeDeferRecoveryCommand,
  ): Promise<PaymentRuntimeAttemptRecord>;
  /** Only encrypted action data crosses this internal port. Use expectedVersion for the authorization check after external KMS decryption. */
  readAttempt(
    command: PaymentRuntimeReadAttemptCommand,
  ): Promise<PaymentRuntimeAttemptRecord | null>;
}

export type PaymentRuntimeRepositories = Readonly<{
  cartRuntime: CartRuntimeRepository;
  paymentRuntime: PaymentRuntimeRepository;
  idempotency: IdempotencyRepository;
  outbox: OutboxRepository;
}>;

export interface PaymentRuntimeTransactionManager {
  /** Same-client SERIALIZABLE callback. External provider and KMS calls occur between transactions. */
  runInPaymentRuntimeTransaction<Result extends JsonValue>(
    work: (repositories: PaymentRuntimeRepositories) => Promise<Result>,
  ): Promise<Result>;
}
