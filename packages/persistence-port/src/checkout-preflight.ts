import {
  checkoutPreflightFailureCodeSchema,
  type CheckoutPreflightCommitCommand,
  type CheckoutPreflightCurrent,
  type CheckoutPreflightFailureCode,
  type CheckoutPreflightFindCommand,
  type CheckoutPreflightLoadCurrentCommand,
  type CheckoutPreflightObservation,
  type CheckoutPreflightReadSessionCommand,
  type CheckoutPreflightReceipt,
  type CheckoutPreflightSaveCommand,
  type CheckoutPreflightSessionRecord,
} from "@fan-support/contracts";
import type { CartRuntimeRepository } from "./cart-runtime.js";
import type {
  IdempotencyRepository,
  InventoryRepository,
  JsonValue,
  OutboxRepository,
} from "./index.js";

export class CheckoutPreflightRepositoryError extends Error {
  readonly code: CheckoutPreflightFailureCode;
  constructor(code: CheckoutPreflightFailureCode) {
    super("Checkout preflight rejected");
    this.name = "CheckoutPreflightRepositoryError";
    this.code = checkoutPreflightFailureCodeSchema.parse(code);
  }
}
export interface CheckoutPreflightRepository {
  /** Reuse complete current publication/projector checks and exact raw media bindings. Schema parsing and CDN URLs are never proof. */
  loadCurrent(
    command: CheckoutPreflightLoadCurrentCommand,
  ): Promise<CheckoutPreflightCurrent>;
  savePreflight(
    command: CheckoutPreflightSaveCommand,
  ): Promise<CheckoutPreflightObservation>;
  readPreflight(
    command: CheckoutPreflightFindCommand,
  ): Promise<CheckoutPreflightObservation | null>;
  /** Writes the immutable quote/order/contact/items/fulfillments, locks cart+intents and records a safe receipt. Inventory is applied by the caller in this same transaction. */
  commit(
    command: CheckoutPreflightCommitCommand,
  ): Promise<CheckoutPreflightReceipt>;
  readSession(
    command: CheckoutPreflightReadSessionCommand,
  ): Promise<CheckoutPreflightSessionRecord | null>;
}
export type CheckoutPreflightRepositories = Readonly<{
  cartRuntime: CartRuntimeRepository;
  checkoutPreflight: CheckoutPreflightRepository;
  inventory: InventoryRepository;
  idempotency: IdempotencyRepository;
  outbox: OutboxRepository;
}>;
export interface CheckoutPreflightTransactionManager {
  runInCheckoutPreflightTransaction<Result extends JsonValue>(
    work: (repositories: CheckoutPreflightRepositories) => Promise<Result>,
  ): Promise<Result>;
}
