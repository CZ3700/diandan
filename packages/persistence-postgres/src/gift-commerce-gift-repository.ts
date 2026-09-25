import {
  giftCommerceReadCommandSchema,
  giftCommerceWriteCommandSchema,
  giftCommerceReceiptReadCommandSchema,
} from "@fan-support/contracts";
import type { GiftCommerceRepository } from "@fan-support/persistence-port";
import { createResourceRun } from "./resource-management-data.js";
import {
  giftCommerceFailure,
  readGiftCommerceReceipt,
} from "./gift-commerce-gift-data.js";
import { readGiftCommerceGift } from "./gift-commerce-gift-read.js";
import { writeGiftCommerceGift } from "./gift-commerce-gift-write.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createGiftCommerceCatalogRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl?: string,
): GiftCommerceRepository {
  const run = createResourceRun(client, scope);
  return {
    read(input) {
      const parsed = giftCommerceReadCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.action !== "READ_GIFT")
        return Promise.resolve(giftCommerceFailure("INVALID_COMMAND"));
      const command = parsed.data;
      return run(() => readGiftCommerceGift(client, command));
    },
    write(input) {
      const parsed = giftCommerceWriteCommandSchema.safeParse(input);
      if (
        !parsed.success ||
        ![
          "CREATE_GIFT",
          "SET_GIFT_STATUS",
          "SAVE_VARIANT",
          "SAVE_GIFT_CONTENT",
        ].includes(parsed.data.command.action)
      )
        return Promise.resolve(giftCommerceFailure("INVALID_COMMAND"));
      return run(() =>
        writeGiftCommerceGift(client, scope, parsed.data, publicMediaBaseUrl),
      );
    },
    readReceipt(input) {
      const parsed = giftCommerceReceiptReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            readGiftCommerceReceipt(
              client,
              parsed.data.resultId,
              parsed.data.actorId,
            ),
          )
        : Promise.resolve(giftCommerceFailure("INVALID_COMMAND"));
    },
  };
}
