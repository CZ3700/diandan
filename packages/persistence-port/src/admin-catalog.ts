import type {
  AdminCatalogReadCommand,
  AdminCatalogResponse,
  AdminCatalogWriteCommand,
  AdminCatalogMutation,
  AdminContentFailure,
  IdolHandleResolutionCommand,
  IdolHandleResolution,
} from "@fan-support/contracts";
import type { AdminAuthorizationRepository } from "./admin-content.js";
import type { IdempotencyRepository, JsonValue } from "./index.js";
export interface AdminCatalogRepository {
  read(command: AdminCatalogReadCommand): Promise<AdminCatalogResponse>;
  write(
    command: AdminCatalogWriteCommand,
  ): Promise<AdminCatalogMutation | AdminContentFailure>;
  readReceipt(command: {
    schemaVersion: 1;
    resultId: string;
    actorId: string;
  }): Promise<AdminCatalogMutation | AdminContentFailure>;
  resolveHandle(
    command: IdolHandleResolutionCommand,
  ): Promise<IdolHandleResolution>;
}
export type AdminCatalogRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  adminCatalog: AdminCatalogRepository;
  idempotency: IdempotencyRepository;
}>;
export interface AdminCatalogTransactionManager {
  runInAdminCatalogTransaction<Result extends JsonValue>(
    work: (repositories: AdminCatalogRepositories) => Promise<Result>,
  ): Promise<Result>;
}
