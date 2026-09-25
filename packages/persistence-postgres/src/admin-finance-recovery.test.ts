import { expect, test, vi } from "vitest";
import type { AdminFinanceClaim } from "@fan-support/contracts";
import { financeClaimRow } from "./admin-finance-data.js";

test("a claim that expires while waiting for its row lock is stale after the lock", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: "operation" }] })
    .mockResolvedValueOnce({ rows: [] });
  const claim = {
    operationId: "operation",
    generation: 1,
    leaseTokenDigest: "a".repeat(64),
  } as AdminFinanceClaim;
  expect(
    await financeClaimRow({ query, release: vi.fn() }, claim),
  ).toBeUndefined();
  expect(query).toHaveBeenCalledTimes(2);
});
