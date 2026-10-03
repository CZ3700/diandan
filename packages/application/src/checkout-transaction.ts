import {
  cartRuntimeHeaderSchema,
  persistencePortResponseSchema,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
  type CheckoutPreflightFailure,
  type CheckoutPreflightFailureCode,
} from "@fan-support/contracts";
import {
  CartRuntimeRepositoryError,
  CheckoutPreflightRepositoryError,
  PersistenceTransactionFailureError,
  type CheckoutPreflightRepositories,
  type CheckoutPreflightTransactionManager,
  type JsonValue,
} from "@fan-support/persistence-port";

export const checkoutFailure = (
  code: CheckoutPreflightFailureCode,
): CheckoutPreflightFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const rejectCheckout = (code: CheckoutPreflightFailureCode): never => {
  throw new CheckoutPreflightRepositoryError(code);
};
export async function authenticateCheckout(
  repos: CheckoutPreflightRepositories,
  context: CartRuntimeRequestContext,
): Promise<CartRuntimeHeader> {
  const value = await repos.cartRuntime.findByCredentialForUpdate({
    schemaVersion: 1,
    accesses: context.accesses,
  });
  if (value === null) return rejectCheckout("CART_NOT_FOUND");
  const cart = cartRuntimeHeaderSchema.parse(value);
  if (cart.expired || cart.status === "EXPIRED")
    return rejectCheckout("CART_EXPIRED");
  return cart;
}
export function requireCheckoutCart(
  cart: CartRuntimeHeader,
  expectedVersion: number,
): void {
  if (cart.status !== "ACTIVE") rejectCheckout("CART_LOCKED");
  if (cart.version !== expectedVersion) rejectCheckout("VERSION_CONFLICT");
}
export function checkoutPersistenceSuccess(value: unknown) {
  const result = persistencePortResponseSchema.parse(value);
  if (result.outcome === "SUCCESS") return result;
  if (result.error.code === "TRANSACTION_ABORTED")
    throw new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: result.error,
    });
  if (
    result.error.code === "TRANSACTION_OUTCOME_UNKNOWN" ||
    result.error.code === "IDEMPOTENCY_CONFLICT"
  )
    return rejectCheckout(result.error.code);
  return rejectCheckout("TEMPORARY_UNAVAILABLE");
}
/** Equal jitter: checkouts that aborted together do not retry in lockstep (audit TXN-01). */
export function checkoutRetryDelayMs(
  attempt: number,
  retryAfterMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = retryAfterMs * 2 ** attempt;
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
export function checkoutTransactions(
  transactions: CheckoutPreflightTransactionManager,
) {
  return async function run<Result extends JsonValue>(
    work: (repos: CheckoutPreflightRepositories) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transactions.runInCheckoutPreflightTransaction(work);
      } catch (error) {
        if (
          !(error instanceof PersistenceTransactionFailureError) ||
          error.failure.error.code !== "TRANSACTION_ABORTED" ||
          attempt >= 2
        )
          throw error;
        const delay = checkoutRetryDelayMs(
          attempt,
          error.failure.error.retryAfterMs ?? 250,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  };
}
export async function withCheckoutFailure<Result>(
  work: () => Promise<Result>,
): Promise<Result | CheckoutPreflightFailure> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof CheckoutPreflightRepositoryError ||
      error instanceof CartRuntimeRepositoryError
    )
      return checkoutFailure(error.code);
    if (
      error instanceof PersistenceTransactionFailureError &&
      error.failure.error.code === "TRANSACTION_OUTCOME_UNKNOWN"
    )
      return checkoutFailure("TRANSACTION_OUTCOME_UNKNOWN");
    return checkoutFailure("TEMPORARY_UNAVAILABLE");
  }
}
