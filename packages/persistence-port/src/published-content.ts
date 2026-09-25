import type {
  PublishedContentReadCommand,
  PublishedContentContextResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface PublishedContentRepository {
  load(
    command: PublishedContentReadCommand,
  ): Promise<PublishedContentContextResponse>;
}
export type PublishedContentRepositories = Readonly<{
  publishedContent: PublishedContentRepository;
}>;
export interface PublishedContentTransactionManager {
  runInPublishedContentTransaction<Result extends JsonValue>(
    work: (repositories: PublishedContentRepositories) => Promise<Result>,
  ): Promise<Result>;
}
