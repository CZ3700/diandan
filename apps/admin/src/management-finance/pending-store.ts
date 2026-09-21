import { adminFinanceCommandSchema } from "@fan-support/contracts";
import type { FinanceDraft } from "./api";
export type PendingFinanceRequest = Readonly<{
  command: FinanceDraft;
  key: string;
}>;
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Tab-local recovery scoped to the authenticated platform identity; never stores credentials or fan content. */
export function createFinancePendingStore(
  storage: PendingStorage,
  actorId: string,
  orderId: string,
) {
  const name = `fan-admin-finance:v1:${actorId}:${orderId}`;
  function read(): PendingFinanceRequest | null {
    const raw = storage.getItem(name);
    if (raw === null) return null;
    const value = adminFinanceCommandSchema.parse(JSON.parse(raw) as unknown);
    if (
      value.action === "LIST" ||
      value.action === "DETAIL" ||
      value.orderId !== orderId
    )
      throw new Error("Invalid pending finance command");
    const { schemaVersion: _version, idempotencyKey: key, ...command } = value;
    void _version;
    return { key, command };
  }
  return {
    read,
    write(request: PendingFinanceRequest) {
      const existing = read();
      if (existing)
        throw new Error("An unresolved finance request already exists");
      const command = adminFinanceCommandSchema.parse({
        ...request.command,
        schemaVersion: 1,
        idempotencyKey: request.key,
      });
      if (
        command.action === "LIST" ||
        command.action === "DETAIL" ||
        command.orderId !== orderId
      )
        throw new Error("Invalid pending finance command");
      storage.setItem(name, JSON.stringify(command));
      const retained = read();
      if (!retained || retained.key !== request.key)
        throw new Error("Finance recovery storage unavailable");
      return retained;
    },
    clear(key: string) {
      if (read()?.key === key) storage.removeItem(name);
    },
  };
}
