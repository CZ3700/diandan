import type {
  AdminSessionReadCommand,
  AdminSessionResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

/** Reads the current canonical session and effective access, without issuing credentials. */
export interface AdminSessionRepository {
  read(command: AdminSessionReadCommand): Promise<AdminSessionResponse>;
}
export type AdminSessionRepositories = Readonly<{
  adminSession: AdminSessionRepository;
}>;
export interface AdminSessionTransactionManager {
  runInAdminSessionTransaction<Result extends JsonValue>(
    work: (repositories: AdminSessionRepositories) => Promise<Result>,
  ): Promise<Result>;
}
