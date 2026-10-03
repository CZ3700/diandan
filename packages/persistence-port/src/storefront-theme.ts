import type {
  AdminPrincipal,
  AdminAuthorizationResponse,
  StorefrontThemeAuthorizationCommand,
  StorefrontThemeCommand,
  StorefrontThemeResponse,
  PublicStorefrontThemeResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface StorefrontThemeRepository {
  execute(
    input: Readonly<{
      command: StorefrontThemeCommand;
      principal: AdminPrincipal;
      requestId: string;
      requestHash: string;
    }>,
  ): Promise<StorefrontThemeResponse>;
  readPublished(): Promise<PublicStorefrontThemeResponse>;
}
export interface StorefrontThemeAuthorizationRepository {
  authorize(
    input: StorefrontThemeAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export type StorefrontThemeRepositories = Readonly<{
  authorization: StorefrontThemeAuthorizationRepository;
  storefrontTheme: StorefrontThemeRepository;
}>;
export interface StorefrontThemeTransactionManager {
  runInStorefrontThemeTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontThemeRepositories) => Promise<Result>,
  ): Promise<Result>;
}
