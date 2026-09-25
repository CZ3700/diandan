import {
  cartRuntimeAccessesSchema,
  paymentRuntimeReadAttemptCommandSchema,
  paymentRuntimeFindCreateReceiptCommandSchema,
} from "@fan-support/contracts";
import { expect, test, vi } from "vitest";
import type { PaymentRuntimeRepository } from "@fan-support/persistence-port";
import type { PostgresQueryLayer } from "./query-layer.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
const loaded = (await import("./payment-runtime-repository.js").catch(
  () => ({}),
)) as {
  createPaymentRuntimeRepository?: (
    client: TransactionClient,
    database: PostgresQueryLayer,
    scope: TransactionScopeControl,
  ) => PaymentRuntimeRepository;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accesses = cartRuntimeAccessesSchema.parse([
  {
    schemaVersion: 1 as const,
    tokenDigest: "a".repeat(64),
    pepperVersion: "test-v1",
  },
]);
const at = "2026-09-09T00:00:00.000001Z";
const cart = {
  id: id(1),
  version: "4",
  status: "LOCKED",
  expired: false,
  presentation_locale: "ja",
  market: "TEST",
  currency: "USD",
  created_at: at,
  updated_at: at,
  expires_at: "2026-09-10T00:00:00.000001Z",
};
function setup(rows: unknown[][]) {
  expect(loaded.createPaymentRuntimeRepository).toBeTypeOf("function");
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  const scope: TransactionScopeControl = {
    markRollbackOnly: vi.fn(),
    trackOperation: async (work) => work(),
  };
  return {
    query,
    repo: loaded.createPaymentRuntimeRepository!(
      { query, release: vi.fn() },
      {} as PostgresQueryLayer,
      scope,
    ),
  };
}
test("current checkout denies an unknown credential before querying business rows", async () => {
  const { repo, query } = setup([[]]);
  await expect(
    repo.loadCurrentCheckout({ schemaVersion: 1, accesses }),
  ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
  expect(query).toHaveBeenCalledTimes(1);
});
test("a valid cart with no checkout returns an empty current checkout", async () => {
  const { repo } = setup([[cart], []]);
  await expect(
    repo.loadCurrentCheckout({ schemaVersion: 1, accesses }),
  ).resolves.toBeNull();
});
test("an expired cart cannot read a payment action", async () => {
  const { repo, query } = setup([[{ ...cart, expired: true }]]);
  await expect(
    repo.readAttempt(
      paymentRuntimeReadAttemptCommandSchema.parse({
        schemaVersion: 1,
        accesses,
        checkoutSessionId: id(2),
        attemptId: id(3),
      }),
    ),
  ).rejects.toMatchObject({ code: "CART_EXPIRED" });
  expect(query).toHaveBeenCalledTimes(1);
});
test("an unrelated attempt is absent under the authenticated cart and session", async () => {
  const { repo, query } = setup([[cart], []]);
  await expect(
    repo.readAttempt(
      paymentRuntimeReadAttemptCommandSchema.parse({
        schemaVersion: 1,
        accesses,
        checkoutSessionId: id(2),
        attemptId: id(3),
      }),
    ),
  ).resolves.toBeNull();
  const statement = query.mock.calls.at(-1);
  expect(statement).toBeDefined();
});
test("permanent create receipts are read without expiring or deleting the original identity", async () => {
  const receipt = {
    schemaVersion: 1,
    receiptId: id(4),
    operationId: id(5),
    cartId: id(1),
    checkoutSessionId: id(2),
    attemptId: id(3),
    idempotencyKey: "payment-replay-key-0001",
    canonicalRequestHash: "b".repeat(64),
    occurredAt: at,
  };
  const { repo, query } = setup([[cart], [{ receipt }]]);
  await expect(
    repo.findCreateReceipt(
      paymentRuntimeFindCreateReceiptCommandSchema.parse({
        schemaVersion: 1,
        accesses,
        checkoutSessionId: id(2),
        idempotencyKey: receipt.idempotencyKey,
      }),
    ),
  ).resolves.toEqual(receipt);
  expect(query).toHaveBeenCalledTimes(2);
});
