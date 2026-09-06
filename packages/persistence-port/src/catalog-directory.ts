import type {
  IdolDirectoryReadCommand,
  IdolDirectorySnapshot,
  GiftDirectoryReadCommand,
  GiftDirectorySnapshot,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface CatalogDirectoryRepository {
  readIdols(command: IdolDirectoryReadCommand): Promise<IdolDirectorySnapshot>;
  readGifts(command: GiftDirectoryReadCommand): Promise<GiftDirectorySnapshot>;
}
export type ContentReadRepositories = Readonly<{
  catalogDirectory: CatalogDirectoryRepository;
}>;
export interface ContentReadTransactionManager {
  /** All directory metadata, windows and published records share a SERIALIZABLE snapshot. */
  runInContentReadTransaction<Result extends JsonValue>(
    work: (repositories: ContentReadRepositories) => Promise<Result>,
  ): Promise<Result>;
}
