import { randomBytes, randomUUID } from "node:crypto";
import {
  adminFinanceClaimRequestSchema,
  adminFinanceClaimSchema,
  adminFinanceSettleCommandSchema,
  adminFinanceSettleResultSchema,
  adminFinanceApplyCommandSchema,
  paymentPortResponseSchema,
  paymentPortResponseMatchesCommand,
  type AdminFinanceClaim,
  type AdminFinanceSettleCommand,
} from "@fan-support/contracts";
import type {
  AdminFinanceTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type {
  PaymentProvider,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";
import { findPaymentProvider } from "./payment-runtime-provider.js";
import { createAdminFinanceEventApplication } from "./admin-finance-events.js";
type Runtime = {
  transactions: AdminFinanceTransactionManager;
  providers: () => readonly PaymentRuntimeProviderRegistration[];
  leaseMs: number;
  retryAfterMs: number;
  /** Raised each time provider work leaves a refund unconfirmed (audit PAY-04). */
  onRefundUnresolved?: () => void;
};
async function claim(runtime: Runtime, operationId: string | null) {
  const result = await runtime.transactions.runInAdminFinanceTransaction(
    async (repository) => {
      const value = await repository.claim(
        adminFinanceClaimRequestSchema.parse({
          schemaVersion: 1,
          operationId,
          requestId: randomUUID(),
          correlationId: randomUUID(),
          leaseTokenDigest: randomBytes(32).toString("hex"),
          leaseDurationMs: runtime.leaseMs,
        }),
      );
      if (value === null) return null;
      const parsed = adminFinanceClaimSchema.parse(value);
      if (operationId !== null && parsed.operationId !== operationId)
        throw new TypeError("Mismatched finance claim");
      return JSON.parse(JSON.stringify(parsed)) as JsonValue;
    },
  );
  return result === null ? null : adminFinanceClaimSchema.parse(result);
}
async function invoke(
  runtime: Runtime,
  work: AdminFinanceClaim,
): Promise<AdminFinanceSettleCommand["result"]> {
  let registration;
  try {
    registration = findPaymentProvider(runtime.providers(), {
      ...work.command,
      adapterKey: work.adapterKey,
    });
  } catch {
    return { kind: "UNCERTAIN", reasonCode: "PROVIDER_UNAVAILABLE" };
  }
  if (!registration)
    return { kind: "UNCERTAIN", reasonCode: "PROVIDER_UNAVAILABLE" };
  const command = work.command;
  try {
    const raw = await dispatch(registration.provider, command);
    const parsed = paymentPortResponseSchema.safeParse(raw);
    return parsed.success &&
      paymentPortResponseMatchesCommand(command, parsed.data)
      ? { kind: "PROVIDER_RESULT", response: parsed.data }
      : { kind: "UNCERTAIN", reasonCode: "PROVIDER_RESPONSE_INVALID" };
  } catch {
    return { kind: "UNCERTAIN", reasonCode: "PROVIDER_NETWORK_UNCERTAINTY" };
  }
}
function dispatch(
  provider: PaymentProvider,
  command: AdminFinanceClaim["command"],
) {
  switch (command.operation) {
    case "REFUND_PAYMENT":
      return provider.refundPayment(command);
    case "CANCEL_PAYMENT":
      return provider.cancelPayment(command);
    case "RECONCILE_REFUND":
      return provider.reconcileRefund(command);
    case "RECONCILE_PAYMENT":
      return provider.reconcilePayment(command);
  }
}
/** Durable ownership always precedes external I/O. An unknown mutation is never redispatched here. */
export function createAdminFinanceRecovery(runtime: Runtime) {
  const events = createAdminFinanceEventApplication(runtime.transactions);
  async function executeClaim(work: AdminFinanceClaim) {
    const result = await invoke(runtime, work);
    const settled = await runtime.transactions.runInAdminFinanceTransaction(
      async (repository) =>
        adminFinanceSettleResultSchema.parse(
          await repository.settle(
            adminFinanceSettleCommandSchema.parse({
              schemaVersion: 1,
              claim: work,
              retryAfterMs: runtime.retryAfterMs,
              result,
            }),
          ),
        ),
    );
    if (settled.operationId !== work.operationId)
      throw new TypeError("Mismatched finance settlement");
    if (work.refundId !== null && settled.decision === "DEFERRED")
      try {
        runtime.onRefundUnresolved?.();
      } catch {
        /* An unavailable alert sink never blocks the durable recovery it reports. */
      }
    if (settled.providerEventId)
      await events.apply(
        adminFinanceApplyCommandSchema.parse({
          schemaVersion: 1,
          providerEventId: settled.providerEventId,
          requestId: work.requestId,
          correlationId: work.correlationId,
          taskName: "admin-finance-provider-evidence",
        }),
      );
    return (
      result.kind === "PROVIDER_RESULT" &&
      result.response.outcome === "SUCCESS" &&
      ["CANCEL_PAYMENT", "REFUND_PAYMENT"].includes(work.command.operation) &&
      settled.decision === "RECORDED"
    );
  }
  async function recover(operationId: string | null) {
    const first = await claim(runtime, operationId);
    if (!first) return false;
    const queryImmediately = await executeClaim(first);
    if (queryImmediately) {
      const next = await claim(runtime, first.operationId);
      if (next) {
        if (
          next.command.operation !== "RECONCILE_PAYMENT" &&
          next.command.operation !== "RECONCILE_REFUND"
        )
          throw new TypeError("Accepted finance operation can only reconcile");
        await executeClaim(next);
      }
    }
    return true;
  }
  return Object.freeze({ recover, runPending: events.runPending });
}
