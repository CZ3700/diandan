import {
  cartRuntimeHeaderSchema,
  persistencePortResponseSchema,
  type CartEditFailure,
  type CartEditFailureCode,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
} from "@fan-support/contracts";
import {
  CartEditRepositoryError,
  CartRuntimeRepositoryError,
  PersistenceTransactionFailureError,
  type CartEditRepositories,
  type CartEditTransactionManager,
  type JsonValue,
} from "@fan-support/persistence-port";
export const cartEditFailure = (
  code: CartEditFailureCode,
): CartEditFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const rejectCartEdit = (code: CartEditFailureCode): never => {
  throw new CartEditRepositoryError(code);
};
export async function authenticateCartEdit(
  repos: CartEditRepositories,
  context: CartRuntimeRequestContext,
): Promise<CartRuntimeHeader> {
  const result = await repos.cartRuntime.findByCredentialForUpdate({
    schemaVersion: 1,
    accesses: context.accesses,
  });
  if (!result) return rejectCartEdit("CART_NOT_FOUND");
  const cart = cartRuntimeHeaderSchema.parse(result);
  if (cart.expired || cart.status === "EXPIRED")
    return rejectCartEdit("CART_EXPIRED");
  if (cart.status !== "ACTIVE") return rejectCartEdit("CART_LOCKED");
  return cart;
}
export function cartEditPersistenceSuccess(input: unknown) {
  const response = persistencePortResponseSchema.parse(input);
  if (response.outcome === "SUCCESS") return response;
  if (response.error.code === "TRANSACTION_ABORTED")
    throw new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: response.error,
    });
  const code = response.error.code;
  if (code === "TRANSACTION_OUTCOME_UNKNOWN" || code === "IDEMPOTENCY_CONFLICT")
    return rejectCartEdit(code);
  return rejectCartEdit("TEMPORARY_UNAVAILABLE");
}
export function cartEditTransactions(transactions: CartEditTransactionManager) {
  return async function run<Result extends JsonValue>(
    work: (repos: CartEditRepositories) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transactions.runInCartEditTransaction(work);
      } catch (error) {
        if (
          error instanceof PersistenceTransactionFailureError &&
          error.failure.error.code === "TRANSACTION_ABORTED" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  };
}
export async function withCartEditFailure<Result>(
  work: () => Promise<Result>,
): Promise<Result | CartEditFailure> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof CartEditRepositoryError ||
      error instanceof CartRuntimeRepositoryError
    )
      return cartEditFailure(error.code);
    if (
      error instanceof PersistenceTransactionFailureError &&
      error.failure.error.code === "TRANSACTION_OUTCOME_UNKNOWN"
    )
      return cartEditFailure("TRANSACTION_OUTCOME_UNKNOWN");
    return cartEditFailure("TEMPORARY_UNAVAILABLE");
  }
}
