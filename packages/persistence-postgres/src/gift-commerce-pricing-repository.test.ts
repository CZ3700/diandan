import { computeGiftCommercePriceHash } from "./gift-commerce-pricing-data.js";
import { describe, it, expect } from "vitest";
import { createGiftCommercePricingRepository } from "./gift-commerce-pricing-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
const scope: TransactionScopeControl = {
  markRollbackOnly: () => undefined,
  trackOperation: async (work) => work(),
};
describe("gift commerce pricing boundary", () => {
  it("rejects unsupported action before touching SQL", async () => {
    let calls = 0;
    const repo = createGiftCommercePricingRepository(
      {
        release: () => undefined,
        query: async () => {
          calls++;
          return { rows: [] };
        },
      },
      scope,
    );
    expect(
      await repo.read({
        schemaVersion: 1,
        action: "READ_INVENTORY",
        giftVariantId: "00000000-0000-4000-8000-000000000001",
        inventoryLocationId: null,
        view: "BALANCES",
        page: 1,
        pageSize: 20,
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(calls).toBe(0);
  });
});
it("hashes immutable complete price evidence without depending on object key order", () => {
  const left = {
    schemaVersion: 1,
    priceBookId: "00000000-0000-4000-8000-000000000001",
    prices: [
      {
        giftVariantId: "00000000-0000-4000-8000-000000000002",
        unitAmountMinor: 100,
        validFrom: "2026-01-01T00:00:00.123456Z",
      },
    ],
  };
  const right = {
    prices: left.prices,
    priceBookId: left.priceBookId,
    schemaVersion: 1,
  };
  expect(computeGiftCommercePriceHash(left)).toBe(
    computeGiftCommercePriceHash(right),
  );
  expect(computeGiftCommercePriceHash(left)).not.toBe(
    computeGiftCommercePriceHash({
      ...left,
      prices: [{ ...left.prices[0], unitAmountMinor: 101 }],
    }),
  );
});
