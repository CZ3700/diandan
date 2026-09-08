import {
  cartRuntimeFailureCodeSchema,
  type CartRuntimeAppendItemCommand,
  type CartRuntimeCredentialCommand,
  type CartRuntimeFailureCode,
  type CartRuntimeFindReceiptCommand,
  type CartRuntimeHeader,
  type CartRuntimeInitializeRecordCommand,
  type CartRuntimeItemRecord,
  type CartRuntimeListItemsCommand,
  type CartRuntimeReceipt,
  type CartRuntimeResolvedGift,
  type CartRuntimeResolveGiftCommand,
} from "@fan-support/contracts";
import type {
  IdempotencyRepository,
  JsonValue,
  OutboxRepository,
} from "./index.js";
import type { StorefrontCommerceRepository } from "./storefront-commerce.js";

/** Safe business failures abort the encompassing cart transaction. */
export class CartRuntimeRepositoryError extends Error {
  readonly code: CartRuntimeFailureCode;

  constructor(code: CartRuntimeFailureCode) {
    super("Cart operation rejected");
    this.name = "CartRuntimeRepositoryError";
    this.code = cartRuntimeFailureCodeSchema.parse(code);
  }
}

export interface CartRuntimeRepository {
  initialize(
    command: CartRuntimeInitializeRecordCommand,
  ): Promise<CartRuntimeHeader>;
  findByCredentialForUpdate(
    command: CartRuntimeCredentialCommand,
  ): Promise<CartRuntimeHeader | null>;
  listItems(
    command: CartRuntimeListItemsCommand,
  ): Promise<CartRuntimeItemRecord[]>;
  resolveGiftHandle(
    command: CartRuntimeResolveGiftCommand,
  ): Promise<CartRuntimeResolvedGift | null>;
  appendItem(
    command: CartRuntimeAppendItemCommand,
  ): Promise<CartRuntimeReceipt>;
  findReceipt(
    command: CartRuntimeFindReceiptCommand,
  ): Promise<CartRuntimeReceipt | null>;
}

export type CartRuntimeRepositories = Readonly<{
  cartRuntime: CartRuntimeRepository;
  storefrontCommerce: StorefrontCommerceRepository;
  idempotency: IdempotencyRepository;
  outbox: OutboxRepository;
}>;

export interface CartRuntimeTransactionManager {
  runInCartRuntimeTransaction<Result extends JsonValue>(
    work: (repositories: CartRuntimeRepositories) => Promise<Result>,
  ): Promise<Result>;
}
