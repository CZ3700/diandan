import type {
  AdminPrincipal,
  AdminAuthorizationResponse,
  StorefrontNavigationAuthorizationCommand,
  StorefrontNavigationCommand,
  StorefrontNavigationResponse,
  PublicStorefrontNavigationResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface StorefrontNavigationRepository {
  execute(
    input: Readonly<{
      command: StorefrontNavigationCommand;
      principal: AdminPrincipal;
      requestId: string;
      requestHash: string;
    }>,
  ): Promise<StorefrontNavigationResponse>;
  readPublished(): Promise<PublicStorefrontNavigationResponse>;
}
export interface StorefrontNavigationAuthorizationRepository {
  authorize(
    input: StorefrontNavigationAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export type StorefrontNavigationRepositories = Readonly<{
  authorization: StorefrontNavigationAuthorizationRepository;
  storefrontNavigation: StorefrontNavigationRepository;
}>;
export interface StorefrontNavigationTransactionManager {
  runInStorefrontNavigationTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontNavigationRepositories) => Promise<Result>,
  ): Promise<Result>;
}
