import {
  adminFinanceRequestSchema,
  adminFinanceResponseSchema,
  type AdminFinanceResponse,
} from "@fan-support/contracts";
import { validateAdminContentTokenPepper } from "./admin-content-tokens.js";
import { paymentProviderRegistrations } from "./payment-runtime-provider.js";
import {
  financeFailure,
  financeResponseMatches,
  financeStoreRequest,
  type AdminFinanceDependencies,
} from "./admin-finance-context.js";
import { createAdminFinanceRecovery } from "./admin-finance-runtime.js";
export type { AdminFinanceDependencies } from "./admin-finance-context.js";
/** Authenticated commands commit their permanent receipt before optional immediate provider work. */
export function createAdminFinanceUseCases(
  dependencies: AdminFinanceDependencies,
) {
  if (
    typeof dependencies?.transactions?.runInAdminFinanceTransaction !==
    "function"
  )
    throw new TypeError("Invalid finance transactions");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  const leaseMs = dependencies.leaseMs ?? 30000,
    retryAfterMs = dependencies.retryAfterMs ?? 10000;
  if (
    !Number.isInteger(leaseMs) ||
    leaseMs < 1000 ||
    leaseMs > 300000 ||
    !Number.isInteger(retryAfterMs) ||
    retryAfterMs < 1000 ||
    retryAfterMs > 86400000
  )
    throw new TypeError("Invalid finance recovery timing");
  const runtime = createAdminFinanceRecovery({
    transactions: dependencies.transactions,
    providers: paymentProviderRegistrations(
      dependencies.providers,
      dependencies.providerDirectory,
    ),
    leaseMs,
    retryAfterMs,
  });
  return Object.freeze({
    async execute(input: unknown): Promise<AdminFinanceResponse> {
      const parsed = adminFinanceRequestSchema.safeParse(input);
      if (!parsed.success) return financeFailure("INVALID_COMMAND");
      let response: AdminFinanceResponse;
      try {
        const request = financeStoreRequest(
          parsed.data,
          dependencies.tokenPepper,
        );
        response = adminFinanceResponseSchema.parse(
          await dependencies.transactions.runInAdminFinanceTransaction(
            (repository) => repository.execute(request),
          ),
        );
        if (!financeResponseMatches(parsed.data.command, response))
          return financeFailure("TEMPORARY_UNAVAILABLE");
      } catch {
        return financeFailure("TEMPORARY_UNAVAILABLE");
      }
      if (
        response.outcome === "SUCCESS" &&
        response.kind === "MUTATION" &&
        !response.replayed
      ) {
        try {
          await runtime.recover(response.operationId);
        } catch {
          /* The permanent receipt remains accepted; its durable operation owns subsequent recovery. */
        }
      }
      return response;
    },
    async recoverNext() {
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        processed: await runtime.recover(null),
      };
    },
    runPending: runtime.runPending,
  });
}
export type AdminFinanceUseCases = ReturnType<
  typeof createAdminFinanceUseCases
>;
