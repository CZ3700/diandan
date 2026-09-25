import { describe, expect, it } from "vitest";

const load = () => import("./payment-stablecoin.js").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const config = {
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
  quoteId: "provider-quote-1",
  amountMinor: 1500,
  currency: "USD",
  asset: config,
  atomicAmount: "15001789",
  issuedAt: "2026-09-09T00:00:00.000001Z",
  expiresAt: "2026-09-09T00:05:00.000001Z",
};
const observation = {
  schemaVersion: 1,
  providerAccountId: id,
  environment: "TEST",
  attemptId: id,
  quoteId: "provider-quote-1",
  asset: "USDT",
  network: config.network,
  tokenReference: config.tokenReference,
  decimals: 6,
  paidAtomicAmount: "15001789",
  firstPaymentAt: "2026-09-09T00:04:00Z",
  lastPaymentAt: "2026-09-09T00:04:00Z",
  observedAt: "2026-09-09T00:06:00Z",
  confirmations: 12,
  reorganized: false,
  providerEventId: "provider-event-1",
  evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: id },
};

describe("explicit stablecoin quote contracts", () => {
  it("retains fiat minor units independently from the provider's atomic quote", async () => {
    const schemas = await load();
    expect(schemas?.paymentStablecoinQuoteSchema.safeParse(quote).success).toBe(
      true,
    );
    expect(
      schemas?.paymentStablecoinQuoteSchema.parse(quote).atomicAmount,
    ).toBe("15001789");
    expect(schemas?.paymentStablecoinQuoteSchema.parse(quote).amountMinor).toBe(
      1500,
    );
  });

  it.each([
    { asset: "USDC" },
    { network: "" },
    { tokenReference: "" },
    { decimals: undefined },
    { decimals: 1.5 },
    { decimals: -1 },
    { decimals: 256 },
    { minimumConfirmations: 0 },
    { minimumConfirmations: 1.5 },
    { minimumConfirmations: Number.MAX_SAFE_INTEGER + 1 },
    { privateKey: "not-an-allowed-field" },
  ])(
    "rejects incomplete or implicit asset configuration %j",
    async (change) => {
      const schemas = await load();
      expect(
        schemas?.paymentStablecoinConfigSchema.safeParse({
          ...config,
          ...change,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { currency: "USDT" },
    { amountMinor: 0.1 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { amountMinor: -1 },
    { atomicAmount: "0" },
    { atomicAmount: "01" },
    { atomicAmount: "1e6" },
    { atomicAmount: "1.0" },
    { atomicAmount: "-1" },
    { atomicAmount: "9".repeat(257) },
    { atomicAmount: 15000000 },
    { expiresAt: quote.issuedAt },
    { expiresAt: "2026-09-09T00:00:00.000000Z" },
    { issuedAt: "2026-09-09T00:00:00.0000001Z" },
    { expiresAt: "2026-09-09T00:05:00+00:00" },
    { exchangeRate: 1 },
  ])(
    "rejects malformed quotes without coercing amounts or expiry %j",
    async (change) => {
      const schemas = await load();
      expect(
        schemas?.paymentStablecoinQuoteSchema.safeParse({ ...quote, ...change })
          .success,
      ).toBe(false);
    },
  );

  it("retains distinct actual wrong-asset facts for safe assessment", async () => {
    const schemas = await load();
    expect(
      schemas?.paymentStablecoinObservationSchema.safeParse({
        ...observation,
        asset: "USDC",
        network: "other-network",
      }).success,
    ).toBe(true);
  });

  it("requires a referenced webhook or audit source, never a boolean", async () => {
    const schemas = await load();
    for (const evidence of [
      undefined,
      true,
      { authenticated: true },
      { kind: "AUTHENTICATED_RECONCILE" },
      { kind: "BROWSER_RETURN", auditLogId: id },
    ]) {
      expect(
        schemas?.paymentStablecoinObservationSchema.safeParse({
          ...observation,
          evidence,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas?.paymentStablecoinObservationSchema.safeParse(observation)
        .success,
    ).toBe(true);
    expect(
      schemas?.paymentStablecoinObservationSchema.safeParse({
        ...observation,
        evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: id },
      }).success,
    ).toBe(true);
  });

  it("keeps payment times separate from later confirmations and validates their order", async () => {
    const schemas = await load();
    expect(
      schemas?.paymentStablecoinObservationSchema.safeParse(observation)
        .success,
    ).toBe(true);
    for (const change of [
      { firstPaymentAt: null },
      { lastPaymentAt: null },
      { firstPaymentAt: "2026-09-09T00:04:00.000001Z" },
      { lastPaymentAt: "2026-09-09T00:06:00.000001Z" },
      { paidAtomicAmount: "0" },
      { confirmations: -1 },
      { confirmations: 1.1 },
    ]) {
      expect(
        schemas?.paymentStablecoinObservationSchema.safeParse({
          ...observation,
          ...change,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas?.paymentStablecoinObservationSchema.safeParse({
        ...observation,
        paidAtomicAmount: "0",
        firstPaymentAt: null,
        lastPaymentAt: null,
        confirmations: 0,
      }).success,
    ).toBe(true);
  });

  it("has no successful-payment or order-state result", async () => {
    const schemas = await load();
    for (const value of [
      { outcome: "SUCCEEDED" },
      { outcome: "PAID" },
      { outcome: "MATCHED_EVIDENCE", reason: "INSUFFICIENT_CONFIRMATIONS" },
      { outcome: "PENDING", reason: "LATE_PAYMENT" },
    ]) {
      expect(
        schemas?.paymentStablecoinEvaluationSchema.safeParse({
          schemaVersion: 1,
          ...value,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas?.paymentStablecoinEvaluationSchema.safeParse({
        schemaVersion: 1,
        outcome: "MATCHED_EVIDENCE",
      }).success,
    ).toBe(true);
  });
});
