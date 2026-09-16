import { expect, test, vi } from "vitest";
import type {
  CommerceExpiryRepository,
  CommerceExpiryTransactionManager,
} from "@fan-support/persistence-port";
import * as application from "./index.js";
test("expires each aggregate in its own transaction and continues after a conflicted aggregate", async () => {
  const ids = [
    "12345678-1234-4234-8234-123456789011",
    "12345678-1234-4234-8234-123456789012",
  ];
  const repository: CommerceExpiryRepository = {
    listDue: async () => ({ schemaVersion: 1, cartIds: ids }),
    expireCart: vi.fn<CommerceExpiryRepository["expireCart"]>(
      async (command) => {
        if (command.cartId === ids[0]) throw new Error("transaction conflict");
        return {
          schemaVersion: 1,
          decision: "APPLIED",
          expiredReservations: 1,
          expiredIntents: 0,
          canceledOrders: 0,
          canceledIntents: 0,
          expiredCheckoutSessions: 0,
          expiredCart: false,
          expiredTokens: 0,
          expiredSessions: 0,
        };
      },
    ),
  };
  const run = vi.fn(
    async (work: (repo: CommerceExpiryRepository) => Promise<unknown>) =>
      work(repository),
  );
  const factory = (
    application as unknown as {
      createCommerceExpiryUseCases?: (d: {
        transactions: CommerceExpiryTransactionManager;
      }) => { runPending(limit: number): Promise<unknown> };
    }
  ).createCommerceExpiryUseCases;
  expect(factory).toBeDefined();
  const result = await factory!({
    transactions: {
      runInCommerceExpiryTransaction: run,
    } as CommerceExpiryTransactionManager,
  }).runPending(10);
  expect(run).toHaveBeenCalledTimes(3);
  expect(result).toMatchObject({
    scanned: 2,
    applied: 1,
    failed: 1,
    expiredReservations: 1,
  });
});
