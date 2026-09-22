import { adminExceptionsCommandSchema } from "@fan-support/contracts";
import type { ExceptionMutation } from "./api";
export type PendingExceptionRequest = Readonly<{
  command: ExceptionMutation;
  key: string;
}>;
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** One unresolved operation per authenticated actor and tab; no credentials or private fan content. */
export function createExceptionPendingStore(
  storage: PendingStorage,
  actorId: string,
) {
  const name = `fan-admin-exceptions:v1:${actorId}`;
  function read(): PendingExceptionRequest | null {
    const raw = storage.getItem(name);
    if (raw === null) return null;
    const value = adminExceptionsCommandSchema.parse(
      JSON.parse(raw) as unknown,
    );
    if (!("idempotencyKey" in value))
      throw new Error("Invalid pending exception command");
    const { schemaVersion: _version, idempotencyKey: key, ...command } = value;
    void _version;
    return { key, command };
  }
  return {
    read,
    write(request: PendingExceptionRequest) {
      if (read())
        throw new Error("An unresolved exception command already exists");
      const value = adminExceptionsCommandSchema.parse({
        ...request.command,
        schemaVersion: 1,
        idempotencyKey: request.key,
      });
      if (!("idempotencyKey" in value))
        throw new Error("Invalid pending exception command");
      storage.setItem(name, JSON.stringify(value));
      const retained = read();
      if (
        !retained ||
        JSON.stringify(
          adminExceptionsCommandSchema.parse({
            ...retained.command,
            schemaVersion: 1,
            idempotencyKey: retained.key,
          }),
        ) !== JSON.stringify(value)
      )
        throw new Error("Exception recovery storage unavailable");
      return retained;
    },
    clear(key: string) {
      if (read()?.key === key) storage.removeItem(name);
    },
  };
}
