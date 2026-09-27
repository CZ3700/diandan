import type {
  AdminPrincipal,
  AdminAuthorizationResponse,
  HomeLayoutAuthorizationCommand,
  HomeLayoutCommand,
  HomeLayoutResponse,
  PublicHomeLayoutResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface HomeLayoutRepository {
  execute(
    input: Readonly<{
      command: HomeLayoutCommand;
      principal: AdminPrincipal;
      requestId: string;
      requestHash: string;
    }>,
  ): Promise<HomeLayoutResponse>;
  readPublished(): Promise<PublicHomeLayoutResponse>;
}
export interface HomeLayoutAuthorizationRepository {
  authorize(
    input: HomeLayoutAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export type HomeLayoutRepositories = Readonly<{
  authorization: HomeLayoutAuthorizationRepository;
  homeLayout: HomeLayoutRepository;
}>;
export interface HomeLayoutTransactionManager {
  runInHomeLayoutTransaction<Result extends JsonValue>(
    work: (repositories: HomeLayoutRepositories) => Promise<Result>,
  ): Promise<Result>;
}
