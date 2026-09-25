import type {
  PublicationPreflightCommand,
  PublicationPreflightContextResponse,
} from "@fan-support/contracts";
import type { AdminAuthorizationRepository } from "./admin-content.js";
import type { JsonValue } from "./index.js";

/** Loads current canonical evidence; the caller owns authorization and snapshot isolation. */
export interface PublicationPreflightRepository {
  load(
    command: PublicationPreflightCommand,
  ): Promise<PublicationPreflightContextResponse>;
}
export type PublicationPreflightRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  publicationPreflight: PublicationPreflightRepository;
}>;
export interface PublicationPreflightTransactionManager {
  runInPublicationPreflightTransaction<Result extends JsonValue>(
    work: (repositories: PublicationPreflightRepositories) => Promise<Result>,
  ): Promise<Result>;
}
