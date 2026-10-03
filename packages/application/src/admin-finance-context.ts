import { createHmac } from "node:crypto";
import {
  adminOrdersAccessSchema,
  adminFinanceStoreRequestSchema,
  type AdminFinanceRequest,
  type AdminFinanceCommand,
  type AdminFinanceResponse,
  type AdminFinanceFailure,
} from "@fan-support/contracts";
import type { AdminFinanceTransactionManager } from "@fan-support/persistence-port";
import type {
  PaymentRuntimeProviderDirectory,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";
import { digestAdminContentToken } from "./admin-content-tokens.js";
export type AdminFinanceDependencies = Readonly<{
  transactions: AdminFinanceTransactionManager;
  tokenPepper: string;
  providers: readonly PaymentRuntimeProviderRegistration[];
  providerDirectory?: PaymentRuntimeProviderDirectory;
  leaseMs?: number;
  retryAfterMs?: number;
  onRefundUnresolved?: () => void;
}>;
export const financeFailure = (
  code: AdminFinanceFailure["code"],
): AdminFinanceFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export function financeStoreRequest(
  request: AdminFinanceRequest,
  tokenPepper: string,
) {
  const digest = (purpose: "admin-session" | "admin-csrf", token: string) =>
    digestAdminContentToken({ tokenPepper, purpose, token });
  return adminFinanceStoreRequestSchema.parse({
    schemaVersion: 1,
    access: adminOrdersAccessSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      correlationId: request.requestId,
      sessionTokenDigest: digest("admin-session", request.sessionToken),
      csrfTokenDigest: digest("admin-csrf", request.csrfToken),
    }),
    command: request.command,
    requestHash:
      "idempotencyKey" in request.command
        ? createHmac("sha256", Buffer.from(tokenPepper, "hex"))
            .update("fan-support:admin-finance:v1:")
            .update(JSON.stringify(request.command))
            .digest("hex")
        : null,
  });
}
export function financeResponseMatches(
  command: AdminFinanceCommand,
  response: AdminFinanceResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  switch (command.action) {
    case "LIST":
      return (
        response.kind === "LIST" &&
        response.page === command.page &&
        response.pageSize === command.pageSize
      );
    case "DETAIL":
      return (
        response.kind === "DETAIL" && response.order.orderId === command.orderId
      );
    case "REFUND":
      return (
        response.kind === "MUTATION" &&
        response.orderId === command.orderId &&
        response.refundId !== null
      );
    case "CANCEL":
      return (
        response.kind === "MUTATION" &&
        response.orderId === command.orderId &&
        response.refundId === null
      );
    case "RECONCILE":
      return (
        response.kind === "MUTATION" &&
        response.orderId === command.orderId &&
        response.refundId ===
          (command.target.kind === "REFUND" ? command.target.refundId : null)
      );
  }
}
