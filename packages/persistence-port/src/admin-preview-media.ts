import type {
  AdminPreviewMediaContextResponse,
  BaseContentTarget,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface AdminPreviewMediaRepository {
  read(
    command: Readonly<{
      schemaVersion: 1;
      target: BaseContentTarget;
      tokenDigest: string;
    }>,
  ): Promise<AdminPreviewMediaContextResponse>;
}
export type AdminPreviewMediaRepositories = Readonly<{
  adminPreviewMedia: AdminPreviewMediaRepository;
}>;
export interface AdminPreviewMediaTransactionManager {
  runInAdminPreviewMediaTransaction<Result extends JsonValue>(
    work: (repositories: AdminPreviewMediaRepositories) => Promise<Result>,
  ): Promise<Result>;
}
