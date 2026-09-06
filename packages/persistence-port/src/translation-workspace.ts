import type {
  TranslationWorkspaceCommand,
  TranslationWorkspaceContextResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
import type { AdminAuthorizationRepository } from "./admin-content.js";
export interface TranslationWorkspaceRepository {
  read(
    command: TranslationWorkspaceCommand,
  ): Promise<TranslationWorkspaceContextResponse>;
}
export type TranslationWorkspaceRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  translationWorkspace: TranslationWorkspaceRepository;
}>;
export interface TranslationWorkspaceTransactionManager {
  runInTranslationWorkspaceTransaction<Result extends JsonValue>(
    work: (repositories: TranslationWorkspaceRepositories) => Promise<Result>,
  ): Promise<Result>;
}
