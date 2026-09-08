import type { JsonValue } from "./index.js";
import type { ManagementCenterRepositories } from "./management-center.js";
import type { ResourceManagementRepository } from "./resource-management.js";

export type ManagementMediaRepositories = ManagementCenterRepositories &
  Readonly<{ resources: ResourceManagementRepository }>;
export interface ManagementMediaTransactionManager {
  runInManagementMediaTransaction<Result extends JsonValue>(
    work: (repositories: ManagementMediaRepositories) => Promise<Result>,
  ): Promise<Result>;
}
