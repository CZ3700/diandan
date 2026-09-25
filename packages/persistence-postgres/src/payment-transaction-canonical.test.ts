import { expect, test, vi } from "vitest";
import { resolveCanonicalPaymentTransaction } from "./payment-transaction-canonical.js";
const facts = {
  providerAccountId: "00000000-0000-4000-8000-000000000001",
  environment: "TEST",
  eventType: "PAYMENT_STATUS",
  status: "SUCCEEDED",
  externalReference: "payment-test",
  amountMinor: 100,
  currency: "USD",
  transaction: { type: "CAPTURE", providerReference: "capture-test" },
};
function client(rows: unknown[][]) {
  return {
    query: vi.fn<
      (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
    >(async () => ({
      rows: rows.shift() ?? [],
    })),
    release: vi.fn(),
  };
}
test("an existing canonical capture with different amount or identity is rejected before another source is recorded", async () => {
  const c = client([
    [{ supported: true }],
    [],
    [{ id: "canonical", matches: false, complete: true }],
  ]);
  await expect(
    resolveCanonicalPaymentTransaction(c, facts),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(c.query).toHaveBeenCalledTimes(3);
});
test("a complete canonical capture is reused without producing another ledger", async () => {
  const c = client([
    [{ supported: true }],
    [],
    [{ id: "canonical", matches: true, complete: true }],
  ]);
  await expect(resolveCanonicalPaymentTransaction(c, facts)).resolves.toEqual({
    supported: true,
    canonicalId: "canonical",
  });
  expect(c.query).toHaveBeenCalledTimes(3);
});
test("an early source without a bound reference remains retryable and cannot fake a canonical ledger", async () => {
  const c = client([
    [{ supported: true }],
    [],
    [{ id: "canonical", matches: true, complete: false }],
    [],
  ]);
  await expect(
    resolveCanonicalPaymentTransaction(c, facts),
  ).rejects.toMatchObject({
    code: "TRANSACTION_ABORTED",
    recovery: "RETRY_SAME_COMMAND",
  });
  expect(c.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
    false,
  );
});
test("a source already associated to a different attempt never changes that association", async () => {
  const c = client([
    [{ supported: true }],
    [],
    [{ id: "canonical", matches: true, complete: false }],
    [{ id: "target" }],
    [{ payment_attempt_id: "other" }],
  ]);
  await expect(
    resolveCanonicalPaymentTransaction(c, facts),
  ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });
  expect(c.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
    false,
  );
});
test("duplicate refund transaction sources reuse their canonical ledger and match platform refund correlation", async () => {
  const c = client([
    [{ supported: true }],
    [],
    [{ id: "canonical-refund", matches: true, complete: true }],
  ]);
  await expect(
    resolveCanonicalPaymentTransaction(c, {
      ...facts,
      eventType: "REFUND_STATUS",
      refundReference: "refund-correlation",
      transaction: { type: "REFUND", providerReference: "refund-transaction" },
    }),
  ).resolves.toEqual({ supported: true, canonicalId: "canonical-refund" });
  expect(
    c.query.mock.calls.some(([sql]) =>
      sql.includes("provider_refund_reference"),
    ),
  ).toBe(true);
});
