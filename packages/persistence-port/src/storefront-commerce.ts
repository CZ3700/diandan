import type {
  StorefrontContextReadCommand,
  StorefrontContextResponse,
  StorefrontGiftReadCommand,
  StorefrontGiftContextResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface StorefrontCommerceRepository {
  readContext(
    command: StorefrontContextReadCommand,
  ): Promise<StorefrontContextResponse>;
  loadGift(
    command: StorefrontGiftReadCommand,
  ): Promise<StorefrontGiftContextResponse>;
}
export type StorefrontCommerceRepositories = Readonly<{
  storefrontCommerce: StorefrontCommerceRepository;
}>;
export interface StorefrontCommerceTransactionManager {
  runInStorefrontCommerceTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontCommerceRepositories) => Promise<Result>,
  ): Promise<Result>;
}
