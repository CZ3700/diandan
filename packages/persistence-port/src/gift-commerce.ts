import type {
  GiftCommerceAuthorizationCommand,
  GiftCommerceAuthorizationResponse,
  GiftCommerceAccessContextCommand,
  GiftCommerceAccessContextResponse,
  GiftCommerceReadCommand,
  GiftCommerceWriteCommand,
  GiftCommerceReceiptReadCommand,
  GiftCommerceReadResponse,
  GiftCommerceRawContext,
  GiftCommerceMutation,
  GiftCommerceFailure,
} from "@fan-support/contracts";
import type { AdminAuthorizationRepository } from "./admin-content.js";
import type { ContentAuthoringRepository } from "./content-authoring.js";
import type { IdempotencyRepository, JsonValue } from "./index.js";

export interface GiftCommerceAuthorizationRepository {
  authorize(
    command: GiftCommerceAuthorizationCommand,
  ): Promise<GiftCommerceAuthorizationResponse>;
  context(
    command: GiftCommerceAccessContextCommand,
  ): Promise<GiftCommerceAccessContextResponse>;
}

/** Catalog, pricing and inventory implementations accept only their explicit action subsets. */
export interface GiftCommerceRepository {
  read(
    command: GiftCommerceReadCommand,
  ): Promise<GiftCommerceReadResponse | GiftCommerceRawContext>;
  write(
    command: GiftCommerceWriteCommand,
  ): Promise<GiftCommerceMutation | GiftCommerceFailure>;
  readReceipt(
    command: GiftCommerceReceiptReadCommand,
  ): Promise<GiftCommerceMutation | GiftCommerceFailure>;
}

export type GiftCommerceRepositories = Readonly<{
  authorization: GiftCommerceAuthorizationRepository;
  contentAuthorization: AdminAuthorizationRepository;
  contentAuthoring: ContentAuthoringRepository;
  catalog: GiftCommerceRepository;
  pricing: GiftCommerceRepository;
  inventory: GiftCommerceRepository;
  idempotency: IdempotencyRepository;
}>;

export interface GiftCommerceTransactionManager {
  runInGiftCommerceTransaction<Result extends JsonValue>(
    work: (repositories: GiftCommerceRepositories) => Promise<Result>,
  ): Promise<Result>;
}
