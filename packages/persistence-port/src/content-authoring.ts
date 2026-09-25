import type {
  AdminMutationResponse,
  ContentAuthoringReadCommand,
  ContentAuthoringReadResponse,
  ContentAuthoringWriteCommand,
} from "@fan-support/contracts";
import type { JsonValue, IdempotencyRepository } from "./index.js";
import type { AdminAuthorizationRepository } from "./admin-content.js";
export interface ContentAuthoringRepository {
  read(
    command: ContentAuthoringReadCommand,
  ): Promise<ContentAuthoringReadResponse>;
  write(command: ContentAuthoringWriteCommand): Promise<AdminMutationResponse>;
}
export type ContentAuthoringRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  contentAuthoring: ContentAuthoringRepository;
  idempotency: IdempotencyRepository;
}>;
export interface ContentAuthoringTransactionManager {
  runInContentAuthoringTransaction<Result extends JsonValue>(
    work: (repositories: ContentAuthoringRepositories) => Promise<Result>,
  ): Promise<Result>;
}
