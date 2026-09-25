import {
  giftCommerceReadCommandSchema,
  giftCommerceWriteCommandSchema,
  giftCommerceReceiptReadCommandSchema,
} from "@fan-support/contracts";
import type { GiftCommerceRepository } from "@fan-support/persistence-port";
import { createResourceRun } from "./resource-management-data.js";
import { commerceFailure } from "./gift-commerce-pricing-data.js";
import {
  readCommerceInventory,
  writeCommerceInventory,
  readInventoryReceipt,
} from "./gift-commerce-inventory-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createGiftCommerceInventoryRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): GiftCommerceRepository {
  const run = createResourceRun(client, scope);
  return {
    read(input) {
      const parsed = giftCommerceReadCommandSchema.safeParse(input);
      return parsed.success && parsed.data.action === "READ_INVENTORY"
        ? run(() => readCommerceInventory(client, parsed.data))
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
    write(input) {
      const parsed = giftCommerceWriteCommandSchema.safeParse(input);
      return parsed.success &&
        ["CREATE_INVENTORY_LOCATION", "ADJUST_INVENTORY"].includes(
          parsed.data.command.action,
        )
        ? run(() => writeCommerceInventory(client, parsed.data))
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
    readReceipt(input) {
      const parsed = giftCommerceReceiptReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            readInventoryReceipt(
              client,
              parsed.data.resultId,
              parsed.data.actorId,
            ),
          )
        : Promise.resolve(commerceFailure("INVALID_COMMAND"));
    },
  };
}
