import { randomUUID } from "node:crypto";
import {
  commerceExpiryCommandSchema,
  commerceExpiryListCommandSchema,
  commerceExpiryListResultSchema,
  commerceExpiryResultSchema,
  commerceExpiryRunResultSchema,
} from "@fan-support/contracts";
import type { CommerceExpiryTransactionManager } from "@fan-support/persistence-port";

/** Expiry is authorized by current database facts, never by a timer's claimed timestamp. */
export function createCommerceExpiryUseCases({
  transactions,
  createId = randomUUID,
}: {
  transactions: CommerceExpiryTransactionManager;
  createId?: () => string;
}) {
  const runPending = async (limit: number) => {
    const command = commerceExpiryListCommandSchema.parse({
      schemaVersion: 1,
      limit,
    });
    const listed = await transactions.runInCommerceExpiryTransaction(
      async (repo) =>
        commerceExpiryListResultSchema.parse(await repo.listDue(command)),
    );
    if (
      listed.cartIds.length > limit ||
      new Set(listed.cartIds).size !== listed.cartIds.length
    )
      throw new Error("Commerce expiry unavailable");
    const result = {
      schemaVersion: 1 as const,
      scanned: listed.cartIds.length,
      applied: 0,
      skipped: 0,
      failed: 0,
      expiredReservations: 0,
      expiredIntents: 0,
      canceledOrders: 0,
      canceledIntents: 0,
      expiredCarts: 0,
      expiredTokens: 0,
      expiredSessions: 0,
      expiredCheckoutSessions: 0,
    };
    for (const cartId of listed.cartIds) {
      try {
        const input = commerceExpiryCommandSchema.parse({
          schemaVersion: 1,
          cartId,
          requestId: createId(),
          correlationId: createId(),
          taskName: "commerce-expiry",
        });
        const expired = await transactions.runInCommerceExpiryTransaction(
          async (repo) =>
            commerceExpiryResultSchema.parse(await repo.expireCart(input)),
        );
        if (expired.decision === "APPLIED") result.applied++;
        else result.skipped++;
        for (const key of [
          "expiredReservations",
          "expiredIntents",
          "canceledOrders",
          "canceledIntents",
          "expiredTokens",
          "expiredSessions",
          "expiredCheckoutSessions",
        ] as const)
          result[key] += expired[key];
        if (expired.expiredCart) result.expiredCarts++;
      } catch {
        result.failed++;
      }
    }
    return commerceExpiryRunResultSchema.parse(result);
  };
  return Object.freeze({ runPending });
}
