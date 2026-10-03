import { expect, test, vi } from "vitest";
import type {
  AdminFinanceClaim,
  AdminFinanceSettleCommand,
} from "@fan-support/contracts";
import { financeClaimRow } from "./admin-finance-data.js";
import {
  financeRetryDelayMs,
  financeSettleErrorCode,
} from "./admin-finance-recovery.js";

test("unresolved finance work backs off by claim generation up to one hour (audit PAY-04)", () => {
  expect(financeRetryDelayMs(10_000, 1)).toBe(10_000);
  expect(financeRetryDelayMs(10_000, 2)).toBe(20_000);
  expect(financeRetryDelayMs(10_000, 4)).toBe(80_000);
  expect(financeRetryDelayMs(10_000, 9)).toBe(2_560_000);
  expect(financeRetryDelayMs(10_000, 10)).toBe(3_600_000);
  expect(financeRetryDelayMs(10_000, 5_000)).toBe(3_600_000);
  expect(financeRetryDelayMs(1_000, 0)).toBe(1_000);
});

test("an explicit provider refusal keeps its own code and never reads as undispatched", () => {
  const failure = (code: string) =>
    ({
      kind: "PROVIDER_RESULT",
      response: {
        schemaVersion: 1,
        operation: "REFUND_PAYMENT",
        outcome: "FAILURE",
        error: { code, recovery: "NONE" },
      },
    }) as unknown as AdminFinanceSettleCommand["result"];
  expect(financeSettleErrorCode(failure("PROVIDER_DECLINED"))).toBe(
    "PROVIDER_DECLINED",
  );
  expect(financeSettleErrorCode(failure("REFUND_NOT_FOUND"))).toBe(
    "REFUND_NOT_FOUND",
  );
  expect(
    financeSettleErrorCode({
      kind: "UNCERTAIN",
      reasonCode: "PROVIDER_UNAVAILABLE",
    }),
  ).toBe("PROVIDER_UNAVAILABLE");
  expect(
    financeSettleErrorCode({
      kind: "PROVIDER_RESULT",
      response: { outcome: "SUCCESS" },
    } as unknown as AdminFinanceSettleCommand["result"]),
  ).toBeNull();
});

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
