import type {
  PublishedContentContextResponse,
  StorefrontSeoLocator,
  StorefrontSeoCursorPayload,
  StorefrontSeoSnapshot,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface StorefrontSeoRepository {
  loadEntity(
    locator: StorefrontSeoLocator,
  ): Promise<PublishedContentContextResponse>;
  readIndex(
    cursor: StorefrontSeoCursorPayload | undefined,
  ): Promise<StorefrontSeoSnapshot>;
  readCatalog(
    cursor: StorefrontSeoCursorPayload | undefined,
  ): Promise<StorefrontSeoSnapshot>;
}
export type StorefrontSeoRepositories = Readonly<{
  storefrontSeo: StorefrontSeoRepository;
}>;
export interface StorefrontSeoTransactionManager {
  runInStorefrontSeoTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontSeoRepositories) => Promise<Result>,
  ): Promise<Result>;
}
