import {
  adminFinanceResponseSchema,
  type AdminFinanceCommand,
  type AdminFinanceResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
export type FinanceDetail = Extract<AdminFinanceResponse, { kind: "DETAIL" }>;
export type FinanceList = Extract<AdminFinanceResponse, { kind: "LIST" }>;
export type FinanceCommand<Action extends AdminFinanceCommand["action"]> = Omit<
  Extract<AdminFinanceCommand, { action: Action }>,
  "schemaVersion" | "action" | "idempotencyKey"
>;
export type FinanceMutation = Extract<
  AdminFinanceCommand,
  { action: "REFUND" | "CANCEL" | "RECONCILE" }
>;
export type FinanceDraft = FinanceMutation extends infer T
  ? T extends FinanceMutation
    ? Omit<T, "schemaVersion" | "idempotencyKey">
    : never
  : never;
const invalid = () => new AdminClientError("INVALID_RESPONSE");
export function createFinanceApi(client: AdminClient) {
  const call = (
    action: string,
    command: Record<string, unknown>,
    key?: string,
  ) =>
    client.call(
      `finance-${action}`,
      { schemaVersion: 1, ...command },
      adminFinanceResponseSchema,
      key !== undefined,
      key,
    );
  const mutate = async (
    action: string,
    command: { orderId: string } & Record<string, unknown>,
    key: string,
  ) => {
    const value = await call(action, command, key);
    if (value.kind !== "MUTATION" || value.orderId !== command.orderId)
      throw invalid();
    return value;
  };
  return {
    async list(command: FinanceCommand<"LIST">): Promise<FinanceList> {
      const value = await call("list", command);
      if (
        value.kind !== "LIST" ||
        value.page !== command.page ||
        value.pageSize !== command.pageSize
      )
        throw invalid();
      return value;
    },
    async detail(orderId: string): Promise<FinanceDetail> {
      const value = await call("detail", { orderId });
      if (value.kind !== "DETAIL" || value.order.orderId !== orderId)
        throw invalid();
      return value;
    },
    refund: (command: FinanceCommand<"REFUND">, key: string) =>
      mutate("refund", command, key),
    cancel: (command: FinanceCommand<"CANCEL">, key: string) =>
      mutate("cancel", command, key),
    reconcile: (command: FinanceCommand<"RECONCILE">, key: string) =>
      mutate("reconcile", command, key),
  };
}
export type FinanceApi = ReturnType<typeof createFinanceApi>;
