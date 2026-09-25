import type {
  StorefrontHomepageReadCommand,
  StorefrontHomepageContextResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface StorefrontHomepageRepository {
  load(
    command: StorefrontHomepageReadCommand,
  ): Promise<StorefrontHomepageContextResponse>;
}
export type StorefrontHomepageRepositories = Readonly<{
  storefrontHomepage: StorefrontHomepageRepository;
}>;
export interface StorefrontHomepageTransactionManager {
  runInStorefrontHomepageTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontHomepageRepositories) => Promise<Result>,
  ): Promise<Result>;
}
