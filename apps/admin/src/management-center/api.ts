import {
  managementCenterResponseSchema,
  type ManagementCenterCommand,
  type ManagementCenterIntent,
  type ManagementCenterResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

export type ManagementContext = Extract<
  ManagementCenterResponse,
  { kind: "CONTEXT" }
>;
export type ManagementList = Extract<
  ManagementCenterResponse,
  { kind: "LIST" }
>;
export type ManagementSection = ManagementList["section"];
export type PreparedUpload = Extract<
  ManagementCenterResponse,
  { kind: "UPLOAD_GRANT" }
>;
type PrepareCommand = Omit<
  Extract<ManagementCenterCommand, { action: "PREPARE_UPLOAD" }>,
  "action" | "idempotencyKey"
>;

export function createManagementApi(client: AdminClient) {
  const call = (
    key: string,
    command: Record<string, unknown> = {},
    mutation = false,
  ) =>
    client.call(
      `management-${key}`,
      { schemaVersion: 1, ...command },
      managementCenterResponseSchema,
      mutation,
    );
  const invalid = () => new AdminClientError("INVALID_RESPONSE");
  return {
    async context(): Promise<ManagementContext> {
      const result = await call("context");
      if (result.kind !== "CONTEXT") throw invalid();
      return result;
    },
    async list(
      section: ManagementSection,
      page: number,
    ): Promise<ManagementList> {
      const result = await call("list", { section, page, pageSize: 12 });
      if (
        result.kind !== "LIST" ||
        result.section !== section ||
        result.page !== page ||
        result.pageSize !== 12
      )
        throw invalid();
      return result;
    },
    async prepare(command: PrepareCommand): Promise<PreparedUpload> {
      const result = await call("prepare-upload", command, true);
      if (result.kind !== "UPLOAD_GRANT") throw invalid();
      return result;
    },
    async submit(intent: ManagementCenterIntent) {
      const result = await call("submit", { intent }, true);
      if (
        result.kind !== "OPERATION" ||
        result.operation.kind !== intent.kind ||
        result.operation.sourceLocale !== intent.sourceLocale ||
        ((intent.kind === "SAVE_ARTIST" || intent.kind === "SAVE_GIFT") &&
          intent.id !== null &&
          result.operation.targetId !== intent.id)
      )
        throw invalid();
      return result.operation;
    },
    async read(operationId: string) {
      const result = await call("read-operation", { operationId });
      if (
        result.kind !== "OPERATION" ||
        result.operation.operationId !== operationId
      )
        throw invalid();
      return result.operation;
    },
    async retry(operationId: string, expectedVersion: number) {
      const result = await call(
        "retry-operation",
        { operationId, expectedVersion },
        true,
      );
      if (
        result.kind !== "OPERATION" ||
        result.operation.operationId !== operationId
      )
        throw invalid();
      return result.operation;
    },
  };
}
export type ManagementApi = ReturnType<typeof createManagementApi>;
