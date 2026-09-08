import { createHash } from "node:crypto";
import { canonicalPublicationValue } from "@fan-support/content";
import {
  persistencePortResponseSchema,
  type PaymentRuntimeConfiguration,
  type PaymentRuntimeFailure,
  type PaymentRuntimeFailureCode,
} from "@fan-support/contracts";
import {
  CartRuntimeRepositoryError,
  CheckoutPreflightRepositoryError,
  PaymentRuntimeRepositoryError,
  PersistenceTransactionFailureError,
  type JsonValue,
  type PaymentRuntimeRepositories,
  type PaymentRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { PaymentRuntimeProviderRegistration } from "@fan-support/payment-port";

export type PaymentRuntime = Readonly<{
  run<Result extends JsonValue>(
    work: (repos: PaymentRuntimeRepositories) => Promise<Result>,
  ): Promise<Result>;
  keys: KeyManagementPort;
  providers: readonly PaymentRuntimeProviderRegistration[];
  configuration: PaymentRuntimeConfiguration;
}>;
export const paymentFailure = (
  code: PaymentRuntimeFailureCode,
): PaymentRuntimeFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const rejectPayment = (code: PaymentRuntimeFailureCode): never => {
  throw new PaymentRuntimeRepositoryError(code);
};
export const paymentCommandHash = (value: unknown) =>
  createHash("sha256").update(canonicalPublicationValue(value)).digest("hex");
export function paymentTransactions(
  transactions: PaymentRuntimeTransactionManager,
): PaymentRuntime["run"] {
  return async (work) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transactions.runInPaymentRuntimeTransaction(work);
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
export async function withPaymentFailure<Result>(
  work: () => Promise<Result>,
): Promise<Result | PaymentRuntimeFailure> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof PaymentRuntimeRepositoryError ||
      error instanceof CartRuntimeRepositoryError ||
      error instanceof CheckoutPreflightRepositoryError
    )
      return paymentFailure(error.code);
    if (
      error instanceof PersistenceTransactionFailureError &&
      error.failure.error.code === "TRANSACTION_OUTCOME_UNKNOWN"
    )
      return paymentFailure("TRANSACTION_OUTCOME_UNKNOWN");
    return paymentFailure("TEMPORARY_UNAVAILABLE");
  }
}
export function paymentPersistenceSuccess(input: unknown) {
  const result = persistencePortResponseSchema.parse(input);
  if (result.outcome === "SUCCESS") return result;
  if (result.error.code === "TRANSACTION_ABORTED")
    throw new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: result.error,
    });
  return rejectPayment(
    result.error.code === "TRANSACTION_OUTCOME_UNKNOWN" ||
      result.error.code === "IDEMPOTENCY_CONFLICT"
      ? result.error.code
      : "TEMPORARY_UNAVAILABLE",
  );
}
