import { describe, expect, it } from "vitest";

const load = () => import("./stablecoin.js").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const asset = {
  schemaVersion: 1,
  asset: "USDT",
  network: "test-network",
  tokenReference: "test-token:1",
  decimals: 6,
  minimumConfirmations: 12,
};
const quote = {
  schemaVersion: 1,
  providerAccountId: id,
  environment: "TEST",
  attemptId: id,
  quoteId: "quote-1",
  amountMinor: 1500,
  currency: "USD",
  asset,
  atomicAmount: "15001789",
  issuedAt: "2026-09-09T00:00:00.000001Z",
  expiresAt: "2026-09-09T00:05:00.000001Z",
};
const observation = {
  schemaVersion: 1,
  providerAccountId: id,
  environment: "TEST",
  attemptId: id,
  quoteId: "quote-1",
  asset: "USDT",
  network: asset.network,
  tokenReference: asset.tokenReference,
  decimals: 6,
  paidAtomicAmount: "15001789",
  firstPaymentAt: "2026-09-09T00:04:00Z",
  lastPaymentAt: "2026-09-09T00:04:00Z",
  observedAt: "2026-09-09T00:06:00Z",
  confirmations: 12,
  reorganized: false,
  providerEventId: "event-1",
  evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id },
};
const command = {
  schemaVersion: 1,
  quote,
  observation,
  evaluatedAt: "2026-09-09T00:06:00Z",
};

async function evaluate(change: Record<string, unknown> = {}) {
  const module = await load();
  return module?.evaluateStablecoinPayment({
    ...command,
    observation: { ...observation, ...change },
  });
}

describe("exact stablecoin assessment without payment transitions", () => {
  it("matches a timely exact deposit whose confirmations finish after quote expiry", async () => {
    expect(await evaluate()).toEqual({
      schemaVersion: 1,
      outcome: "MATCHED_EVIDENCE",
    });
  });

  it.each([
    [{ providerAccountId: otherId }, "IDENTITY_MISMATCH"],
    [{ environment: "LIVE" }, "IDENTITY_MISMATCH"],
    [{ attemptId: otherId }, "IDENTITY_MISMATCH"],
    [{ quoteId: "quote-2" }, "IDENTITY_MISMATCH"],
    [{ asset: "USDC" }, "ASSET_MISMATCH"],
    [{ network: "other-network" }, "NETWORK_MISMATCH"],
    [{ tokenReference: "test-token:2" }, "TOKEN_MISMATCH"],
    [{ decimals: 18 }, "DECIMALS_MISMATCH"],
    [{ paidAtomicAmount: "15001788" }, "UNDERPAID"],
    [{ paidAtomicAmount: "15001790" }, "OVERPAID"],
    [{ reorganized: true }, "CHAIN_REORGANIZED"],
    [{ firstPaymentAt: "2026-09-09T00:00:00Z" }, "PAYMENT_BEFORE_QUOTE"],
    [
      { firstPaymentAt: quote.expiresAt, lastPaymentAt: quote.expiresAt },
      "LATE_PAYMENT",
    ],
    [{ lastPaymentAt: quote.expiresAt }, "LATE_PAYMENT"],
  ] as const)("requires review for %j", async (change, reason) => {
    expect(await evaluate(change)).toEqual({
      schemaVersion: 1,
      outcome: "REVIEW",
      reason,
    });
  });

  it("waits for actual confirmations without translating PSP status labels to PAID", async () => {
    expect(await evaluate({ confirmations: 11 })).toEqual({
      schemaVersion: 1,
      outcome: "PENDING",
      reason: "INSUFFICIENT_CONFIRMATIONS",
    });
    expect(await evaluate({ confirmations: 0 })).toEqual({
      schemaVersion: 1,
      outcome: "PENDING",
      reason: "INSUFFICIENT_CONFIRMATIONS",
    });
  });

  it("distinguishes an unpaid live quote from an expired one at the exact microsecond", async () => {
    const module = await load();
    const unpaid = {
      ...observation,
      paidAtomicAmount: "0",
      firstPaymentAt: null,
      lastPaymentAt: null,
      confirmations: 0,
      observedAt: "2026-09-09T00:04:59Z",
    };
    expect(
      module?.evaluateStablecoinPayment({
        ...command,
        observation: unpaid,
        evaluatedAt: "2026-09-09T00:05:00.000000Z",
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "PENDING",
      reason: "AWAITING_PAYMENT",
    });
    expect(
      module?.evaluateStablecoinPayment({
        ...command,
        observation: unpaid,
        evaluatedAt: quote.expiresAt,
      }),
    ).toEqual({ schemaVersion: 1, outcome: "REVIEW", reason: "QUOTE_EXPIRED" });
  });

  it("accepts the last valid microsecond but rejects an observation from the future", async () => {
    expect(
      await evaluate({ lastPaymentAt: "2026-09-09T00:05:00.000000Z" }),
    ).toEqual({ schemaVersion: 1, outcome: "MATCHED_EVIDENCE" });
    expect(
      await evaluate({ observedAt: "2026-09-09T00:06:00.000001Z" }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "REVIEW",
      reason: "OBSERVATION_FROM_FUTURE",
    });
    const module = await load();
    expect(
      module?.evaluateStablecoinPayment({
        ...command,
        evaluatedAt: "2026-09-09T00:00:00Z",
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "REVIEW",
      reason: "QUOTE_NOT_YET_VALID",
    });
  });

  it("compares values beyond Number.MAX_SAFE_INTEGER without rounding a one-atom shortfall", async () => {
    const module = await load();
    const large = "900719925474099312345678901234567890";
    expect(
      module?.evaluateStablecoinPayment({
        ...command,
        quote: { ...quote, atomicAmount: large },
        observation: {
          ...observation,
          paidAtomicAmount: "900719925474099312345678901234567889",
        },
      }),
    ).toEqual({ schemaVersion: 1, outcome: "REVIEW", reason: "UNDERPAID" });
    expect(
      module?.evaluateStablecoinPayment({
        ...command,
        quote: { ...quote, atomicAmount: large },
        observation: { ...observation, paidAtomicAmount: large },
      }),
    ).toEqual({ schemaVersion: 1, outcome: "MATCHED_EVIDENCE" });
  });

  it("rejects a forged authentication flag and never rewrites its input", async () => {
    const module = await load();
    expect(module).not.toBeNull();
    expect(() =>
      module?.evaluateStablecoinPayment({
        ...command,
        observation: { ...observation, evidence: { authenticated: true } },
      }),
    ).toThrow();
    const before = JSON.stringify(command);
    module?.evaluateStablecoinPayment(command);
    expect(JSON.stringify(command)).toBe(before);
  });
});

describe("strict decimal / atomic conversion", () => {
  it.each([
    ["0", 6, "0", "0"],
    ["0.000001", 6, "1", "0.000001"],
    ["15.001789", 6, "15001789", "15.001789"],
    ["15.000000", 6, "15000000", "15"],
    ["120", 0, "120", "120"],
    [
      "9007199254740993.123456",
      6,
      "9007199254740993123456",
      "9007199254740993.123456",
    ],
  ] as const)(
    "converts %s exactly at %i decimals",
    async (decimalAmount, decimals, atomicAmount, canonical) => {
      const module = await load();
      expect(
        module?.decimalToAtomic({ schemaVersion: 1, decimalAmount, decimals }),
      ).toBe(atomicAmount);
      expect(
        module?.atomicToDecimal({ schemaVersion: 1, atomicAmount, decimals }),
      ).toBe(canonical);
    },
  );

  it.each([
    "1e6",
    "+1",
    "-0",
    "01",
    ".1",
    "1.",
    " 1",
    "1\n",
    "1.0000001",
    "1.0000000",
    "NaN",
    "Infinity",
    "9".repeat(257),
  ])(
    "rejects noncanonical or overprecision decimal %s",
    async (decimalAmount) => {
      const module = await load();
      expect(module).not.toBeNull();
      expect(() =>
        module?.decimalToAtomic({
          schemaVersion: 1,
          decimalAmount,
          decimals: 6,
        }),
      ).toThrow();
    },
  );

  it("bounds decimal scale and atom strings without floating-point coercion", async () => {
    const module = await load();
    expect(module).not.toBeNull();
    for (const decimals of [-1, 1.1, 256]) {
      expect(() =>
        module?.decimalToAtomic({
          schemaVersion: 1,
          decimalAmount: "1",
          decimals,
        }),
      ).toThrow();
      expect(() =>
        module?.atomicToDecimal({
          schemaVersion: 1,
          atomicAmount: "1",
          decimals,
        }),
      ).toThrow();
    }
    for (const atomicAmount of [
      "01",
      "1.0",
      "-1",
      "1e6",
      "9".repeat(257),
      123,
    ]) {
      expect(() =>
        module?.atomicToDecimal({
          schemaVersion: 1,
          atomicAmount,
          decimals: 6,
        }),
      ).toThrow();
    }
  });
});
