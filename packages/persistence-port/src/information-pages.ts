import type {
  AdminPrincipal,
  AdminAuthorizationResponse,
  InformationPageAuthorizationCommand,
  InformationPageCommand,
  InformationPageResponse,
  PublicInformationPageRequest,
  PublicInformationPageResponse,
  PublicInformationPageIndexRequest,
  PublicInformationPageIndexResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export type InformationPageAccess = Readonly<{
  readLocales: SupportedLocale[];
  editLocales: SupportedLocale[];
  reviewLocales: SupportedLocale[];
  canPublish: boolean;
  canPreview: boolean;
}>;
export interface InformationPageRepository {
  execute(
    input: Readonly<{
      command: InformationPageCommand;
      principal: AdminPrincipal;
      requestId: string;
      requestHash: string;
      access: InformationPageAccess;
    }>,
  ): Promise<InformationPageResponse>;
  readPublished(
    input: PublicInformationPageRequest,
  ): Promise<PublicInformationPageResponse>;
  readIndex(
    input: PublicInformationPageIndexRequest,
  ): Promise<PublicInformationPageIndexResponse>;
}
export interface InformationPageAuthorizationRepository {
  authorize(
    input: InformationPageAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export type InformationPageRepositories = Readonly<{
  authorization: InformationPageAuthorizationRepository;
  informationPages: InformationPageRepository;
}>;
export interface InformationPageTransactionManager {
  runInInformationPageTransaction<Result extends JsonValue>(
    work: (repositories: InformationPageRepositories) => Promise<Result>,
  ): Promise<Result>;
}
