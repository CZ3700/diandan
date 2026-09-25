import type {
  CreateIdolAliasDraftCommand,
  CreateGiftDetailDraftCommand,
  ContentDraftReadCommand,
  IdolAliasDraftResponse,
  GiftDetailDraftResponse,
  ContentDraftResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

/** Trusted internal persistence only. Authentication belongs to the application boundary. */
export interface ContentDraftRepository {
  createIdolAliases(
    command: CreateIdolAliasDraftCommand,
  ): Promise<IdolAliasDraftResponse>;
  createGiftDetails(
    command: CreateGiftDetailDraftCommand,
  ): Promise<GiftDetailDraftResponse>;
  read(command: ContentDraftReadCommand): Promise<ContentDraftResponse>;
}
export type ContentDraftRepositories = Readonly<{
  contentDrafts: ContentDraftRepository;
}>;
export interface ContentDraftTransactionManager {
  runInContentDraftTransaction<Result extends JsonValue>(
    work: (repositories: ContentDraftRepositories) => Promise<Result>,
  ): Promise<Result>;
}
