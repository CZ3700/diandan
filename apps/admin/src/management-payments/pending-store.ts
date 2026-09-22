import { adminPaymentConfigurationCommandSchema } from "@fan-support/contracts";
import type { PaymentMutation } from "./api";
export type PendingPaymentRequest = Readonly<{
  command: PaymentMutation;
  key: string;
}>;
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** No credentials or merchant secrets; tab-local recovery is scoped to the authenticated platform identity. */
export function createPaymentPendingStore(
  storage: PendingStorage,
  actorId: string,
) {
  const name = `fan-admin-payment-config:v1:${actorId}`;
  function read(): PendingPaymentRequest | null {
    const raw = storage.getItem(name);
    if (raw === null) return null;
    const value = adminPaymentConfigurationCommandSchema.parse(
      JSON.parse(raw) as unknown,
    );
    if (value.action === "READ" || value.action === "VALIDATE")
      throw new Error("Invalid pending payment configuration");
    const { schemaVersion: _version, idempotencyKey: key, ...command } = value;
    void _version;
    return { key, command };
  }
  return {
    read,
    write(request: PendingPaymentRequest) {
      if (read())
        throw new Error("An unresolved configuration command already exists");
      const value = adminPaymentConfigurationCommandSchema.parse({
        ...request.command,
        schemaVersion: 1,
        idempotencyKey: request.key,
      });
      if (value.action === "READ" || value.action === "VALIDATE")
        throw new Error("Invalid pending payment configuration");
      storage.setItem(name, JSON.stringify(value));
      const retained = read();
      if (!retained || retained.key !== request.key)
        throw new Error("Recovery storage unavailable");
      return retained;
    },
    clear(key: string) {
      if (read()?.key === key) storage.removeItem(name);
    },
  };
}
