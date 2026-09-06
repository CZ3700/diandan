import {
  giftCommerceReadCommandSchema,
  giftCommerceWriteCommandSchema,
  giftCommerceReceiptReadCommandSchema,
} from "@fan-support/contracts";
import type { GiftCommerceRepository } from "@fan-support/persistence-port";
import { createResourceRun } from "./resource-management-data.js";
import {
  commerceFailure,
  readPriceReceipt,
} from "./gift-commerce-pricing-data.js";
import { readCommercePrices } from "./gift-commerce-pricing-read.js";
import { writeCommercePrice } from "./gift-commerce-pricing-write.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createGiftCommercePricingRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): GiftCommerceRepository {
  const run = createResourceRun(client, scope);
  return {
    read(input) {
      const parsed = giftCommerceReadCommandSchema.safeParse(input);
      return parsed.success &&
        ["CONTEXT", "READ_PRICES"].includes(parsed.data.action)
        ? run(() => readCommercePrices(client, parsed.data))
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
    write(input) {
      const parsed = giftCommerceWriteCommandSchema.safeParse(input);
      return parsed.success &&
        [
          "CREATE_PRICE_REVISION",
          "PUBLISH_PRICE_BOOK",
          "ROLLBACK_PRICE_BOOK",
        ].includes(parsed.data.command.action)
        ? run(() => writeCommercePrice(client, parsed.data))
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
    readReceipt(input) {
      const parsed = giftCommerceReceiptReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            readPriceReceipt(client, parsed.data.resultId, parsed.data.actorId),
          )
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
  };
}
