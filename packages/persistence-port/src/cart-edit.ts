import {
  cartEditFailureCodeSchema,
  type CartEditFailureCode,
  type CartEditLoadItemCommand,
  type CartEditItemSnapshot,
  type CartEditLoadPrivateCommand,
  type CartEditPrivateSnapshot,
  type CartEditConfirmPrivateCommand,
  type CartEditWriteMutationCommand,
  type CartEditFindMutationReceiptCommand,
  type CartEditMutationReceipt,
} from "@fan-support/contracts";
import type { CartRuntimeRepositories } from "./cart-runtime.js";
import type { JsonValue } from "./index.js";

export class CartEditRepositoryError extends Error {
  readonly code: CartEditFailureCode;
  constructor(code: CartEditFailureCode) {
    super("Cart edit rejected");
    this.name = "CartEditRepositoryError";
    this.code = cartEditFailureCodeSchema.parse(code);
  }
}
export interface CartEditRepository {
  loadItemForUpdate(
    command: CartEditLoadItemCommand,
  ): Promise<CartEditItemSnapshot | null>;
  /** Records authorized access before any external decryption. */
  loadPrivateForEdit(
    command: CartEditLoadPrivateCommand,
  ): Promise<CartEditPrivateSnapshot | null>;
  /** Rechecks ownership, expiry, all versions and the preceding access audit. */
  confirmPrivateRead(
    command: CartEditConfirmPrivateCommand,
  ): Promise<CartEditItemSnapshot>;
  /** Mutates item/intent/cart and writes immutable receipt plus its exact outbox event atomically. */
  writeMutation(
    command: CartEditWriteMutationCommand,
  ): Promise<CartEditMutationReceipt>;
  findMutationReceipt(
    command: CartEditFindMutationReceiptCommand,
  ): Promise<CartEditMutationReceipt | null>;
}
export type CartEditRepositories = CartRuntimeRepositories &
  Readonly<{ cartEdit: CartEditRepository }>;
export interface CartEditTransactionManager {
  runInCartEditTransaction<Result extends JsonValue>(
    work: (repositories: CartEditRepositories) => Promise<Result>,
  ): Promise<Result>;
}
