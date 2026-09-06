import { describe, it, expect } from "vitest";
import { createGiftCommerceInventoryRepository } from "./gift-commerce-inventory-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
const scope: TransactionScopeControl = {
  markRollbackOnly: () => undefined,
  trackOperation: async (work) => work(),
};
describe("gift commerce inventory boundary", () => {
  it("rejects unsupported action before touching SQL", async () => {
    let calls = 0;
    const repo = createGiftCommerceInventoryRepository(
      {
        release: () => undefined,
        query: async () => {
          calls++;
          return { rows: [] };
        },
      },
      scope,
    );
    expect(await repo.read({ schemaVersion: 1, action: "CONTEXT" })).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(calls).toBe(0);
  });
});
