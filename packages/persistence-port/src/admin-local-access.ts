import type {
  AdminLocalAccountFailureCommand,
  AdminLocalAccountFailureResponse,
  AdminLocalAccountReadCommand,
  AdminLocalAccountReadResponse,
  AdminLocalAccountUpdateCommand,
  AdminLocalAccountUpdateResponse,
  AdminLocalLoginFailureCommand,
  AdminLocalLoginFailureResponse,
  AdminLocalLoginProgress,
  AdminLocalLoginReadCommand,
  AdminLocalLoginReadResponse,
  AdminLocalLoginStartCommand,
  AdminLocalStaffCommand,
  AdminLocalStaffResult,
  AdminLocalStepCompleteCommand,
  AdminLocalStepReadCommand,
  AdminLocalStepReadResponse,
} from "@fan-support/contracts";
import type { AdminAccessRepository } from "./admin-access.js";
import type { JsonValue } from "./index.js";

/** L3-10: built-in sign-in. Passwords and codes are verified before a write; writes compare-and-set. */
export interface AdminLocalLoginRepository {
  read(
    command: AdminLocalLoginReadCommand,
  ): Promise<AdminLocalLoginReadResponse>;
  recordFailure(
    command: AdminLocalLoginFailureCommand,
  ): Promise<AdminLocalLoginFailureResponse>;
  start(command: AdminLocalLoginStartCommand): Promise<AdminLocalLoginProgress>;
  readStep(
    command: AdminLocalStepReadCommand,
  ): Promise<AdminLocalStepReadResponse>;
  completeStep(
    command: AdminLocalStepCompleteCommand,
  ): Promise<AdminLocalLoginProgress>;
}
/** The signed-in account's own password and second factor. */
export interface AdminLocalAccountRepository {
  read(
    command: AdminLocalAccountReadCommand,
  ): Promise<AdminLocalAccountReadResponse>;
  recordFailure(
    command: AdminLocalAccountFailureCommand,
  ): Promise<AdminLocalAccountFailureResponse>;
  update(
    command: AdminLocalAccountUpdateCommand,
  ): Promise<AdminLocalAccountUpdateResponse>;
}
/** Staff accounts; every command re-authorizes `staff.manage` in the same transaction. */
export interface AdminLocalStaffRepository {
  execute(command: AdminLocalStaffCommand): Promise<AdminLocalStaffResult>;
}
export type AdminLocalAccessRepositories = Readonly<{
  adminAccess: AdminAccessRepository;
  localLogin: AdminLocalLoginRepository;
  localAccount: AdminLocalAccountRepository;
  localStaff: AdminLocalStaffRepository;
}>;
export interface AdminLocalAccessTransactionManager {
  runInAdminLocalAccessTransaction<Result extends JsonValue>(
    work: (repositories: AdminLocalAccessRepositories) => Promise<Result>,
  ): Promise<Result>;
}
