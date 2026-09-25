import type {
  PublishedGiftCommerceReadCommand,
  PublishedGiftCommerceContextResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface PublishedGiftCommerceRepository {
  load(
    command: PublishedGiftCommerceReadCommand,
  ): Promise<PublishedGiftCommerceContextResponse>;
}
export interface PublishedGiftCommerceTransactionManager {
  runInPublishedGiftCommerceTransaction<Result extends JsonValue>(
    work: (
      repositories: Readonly<{
        publishedGiftCommerce: PublishedGiftCommerceRepository;
      }>,
    ) => Promise<Result>,
  ): Promise<Result>;
}
