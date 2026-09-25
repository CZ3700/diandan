import type {
  AdminAccessRejectCommand,
  AdminAccessRejectResponse,
  AdminAccessCreateCommand,
  AdminAccessCreateResponse,
  AdminAccessClaimCommand,
  AdminAccessClaimResponse,
  AdminAccessCompleteCommand,
  AdminAccessCompleteResponse,
  AdminAccessRevokeCommand,
  AdminAccessLogoutResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
/** Durable single-use login claims and atomic session/audit writes. No provider network inside a transaction. */
export interface AdminAccessRepository {
  create(command: AdminAccessCreateCommand): Promise<AdminAccessCreateResponse>;
  claim(command: AdminAccessClaimCommand): Promise<AdminAccessClaimResponse>;
  complete(
    command: AdminAccessCompleteCommand,
  ): Promise<AdminAccessCompleteResponse>;
  reject(command: AdminAccessRejectCommand): Promise<AdminAccessRejectResponse>;
  revoke(command: AdminAccessRevokeCommand): Promise<AdminAccessLogoutResponse>;
}
export type AdminAccessRepositories = Readonly<{
  adminAccess: AdminAccessRepository;
}>;
export interface AdminAccessTransactionManager {
  runInAdminAccessTransaction<Result extends JsonValue>(
    work: (repositories: AdminAccessRepositories) => Promise<Result>,
  ): Promise<Result>;
}
