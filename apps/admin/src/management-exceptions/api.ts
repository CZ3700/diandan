import {
  adminExceptionsCommandSchema,
  adminExceptionsResponseSchema,
  adminExceptionsResponseMatches,
  type AdminExceptionsCommand,
  type AdminExceptionsResponse,
  type AdminExceptionTarget,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
export type ExceptionsContext = Extract<
  AdminExceptionsResponse,
  { kind: "CONTEXT" }
>;
export type ExceptionsList = Extract<AdminExceptionsResponse, { kind: "LIST" }>;
export type ExceptionsDetail = Extract<
  AdminExceptionsResponse,
  { kind: "DETAIL" }
>;
export type ExceptionsFilters = Omit<
  Extract<AdminExceptionsCommand, { action: "LIST" }>,
  "schemaVersion" | "action"
>;
type Mutation = Exclude<
  AdminExceptionsCommand,
  { action: "CONTEXT" | "LIST" | "DETAIL" }
>;
export type ExceptionMutation = Mutation extends infer T
  ? T extends Mutation
    ? Omit<T, "schemaVersion" | "idempotencyKey">
    : never
  : never;
export function createExceptionsApi(client: AdminClient) {
  async function call(command: AdminExceptionsCommand) {
    const value = await client.call(
      `exceptions-${command.action.toLowerCase().replaceAll("_", "-")}`,
      command,
      adminExceptionsResponseSchema,
      "idempotencyKey" in command,
      "idempotencyKey" in command ? command.idempotencyKey : undefined,
    );
    if (!adminExceptionsResponseMatches(command, value))
      throw new AdminClientError("INVALID_RESPONSE");
    return value;
  }
  return {
    async context() {
      const value = await call({ schemaVersion: 1, action: "CONTEXT" });
      if (value.kind !== "CONTEXT")
        throw new AdminClientError("INVALID_RESPONSE");
      return value;
    },
    async list(filters: ExceptionsFilters) {
      const value = await call({
        schemaVersion: 1,
        action: "LIST",
        ...filters,
      });
      if (value.kind !== "LIST") throw new AdminClientError("INVALID_RESPONSE");
      return value;
    },
    async detail(target: AdminExceptionTarget) {
      const value = await call({ schemaVersion: 1, action: "DETAIL", target });
      if (value.kind !== "DETAIL")
        throw new AdminClientError("INVALID_RESPONSE");
      return value;
    },
    async mutate(command: ExceptionMutation, key: string) {
      const value = await call(
        adminExceptionsCommandSchema.parse({
          ...command,
          schemaVersion: 1,
          idempotencyKey: key,
        }),
      );
      if (value.kind !== "MUTATION")
        throw new AdminClientError("INVALID_RESPONSE");
      return value;
    },
  };
}
export type ExceptionsApi = ReturnType<typeof createExceptionsApi>;
