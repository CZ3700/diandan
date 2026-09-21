import { orderPaymentApplyCommandSchema } from "@fan-support/contracts";
import { expect, test, vi } from "vitest";
import type {
  InventoryRepository,
  OutboxRepository,
} from "@fan-support/persistence-port";
import type { TransactionScopeControl } from "./transaction-runner.js";
import { createOrderPaymentApplicationRepository } from "./order-payment-application.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = orderPaymentApplyCommandSchema.parse({
  schemaVersion: 1 as const,
  providerEventId: id(1),
  requestId: id(2),
  correlationId: id(3),
  taskName: "order-payment-apply",
});
function setup(rows: unknown[][]) {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({
    rows: rows.shift() ?? [],
  }));
  const scope: TransactionScopeControl = {
    markRollbackOnly: vi.fn(),
    trackOperation: async (work) => work(),
  };
  return {
    query,
    repo: createOrderPaymentApplicationRepository(
      { query, release: vi.fn() },
      {} as InventoryRepository,
      {} as OutboxRepository,
      scope,
    ),
  };
}
test("rejects absent evidence before any financial mutation", async () => {
  const { repo, query } = setup([[]]);
  await expect(repo.apply(command)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(query).toHaveBeenCalledTimes(1);
});
test("a durable application receipt replays without touching inventory or canonical state", async () => {
  const receipt = {
    schemaVersion: 1,
    receiptId: id(4),
    providerEventId: id(1),
    decision: "APPLIED",
    attemptId: id(5),
    orderId: id(6),
    outcome: "PAID",
  };
  const { repo, query } = setup([[{ id: id(1) }], [{ result: receipt }]]);
  await expect(repo.apply(command)).resolves.toEqual({
    ...receipt,
    decision: "ALREADY_APPLIED",
  });
  expect(query).toHaveBeenCalledTimes(2);
});
test("pending scans advance a durable due cursor before returning a bounded batch", async () => {
  const { repo, query } = setup([[{ provider_event_id: id(1) }]]);
  await expect(
    repo.listPending({ schemaVersion: 1, limit: 2 }),
  ).resolves.toEqual({ schemaVersion: 1, providerEventIds: [id(1)] });
  expect(query.mock.calls[0]?.[0]).toContain(
    "INSERT INTO public.order_payment_application_schedule",
  );
  expect(query.mock.calls[0]?.[0]).toContain("SKIP LOCKED");
  expect(query.mock.calls[0]?.[0]).toContain("next_attempt_at");
});

for (const [field, value] of [
  ["external_reference", "a-different-payment"],
  ["provider_account_id", id(99)],
] as const) {
  test(`a matched event cannot overwrite conflicting ${field}`, async () => {
    const event = {
      id: id(1),
      provider_account_id: id(7),
      environment: "TEST",
      external_payment_reference: "payment-reference",
      amount_minor: 100,
      currency: "USD",
      event_type: "PAYMENT_STATUS",
      normalized_status: "PROCESSING",
    };
    const attempt = {
      id: id(5),
      provider_account_id: id(7),
      environment: "TEST",
      external_reference: null,
      amount_minor: 100,
      currency: "USD",
      [field]: value,
    };
    const { repo, query } = setup([
      [event],
      [],
      [{ id: id(5), order_id: id(6), cart_id: id(8) }],
      [{ id: id(8) }],
      [{ id: id(6) }],
      [attempt],
      [{ payment_attempt_id: id(5) }],
    ]);
    await expect(repo.apply(command)).resolves.toMatchObject({
      decision: "REVIEW",
      reasonCode: "PAYMENT_IDENTITY_MISMATCH",
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE public.payment_attempts"),
      ),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.startsWith("INSERT INTO public.provider_event_associations"),
      ),
    ).toBe(false);
  });
}
test("a persisted matched association is used before external-reference fallback", async () => {
  const event = {
    id: id(1),
    provider_account_id: id(7),
    environment: "TEST",
    external_payment_reference: "payment-reference",
    amount_minor: 100,
    currency: "USD",
    event_type: "PAYMENT_STATUS",
    normalized_status: "PROCESSING",
  };
  const attempt = {
    id: id(5),
    provider_account_id: id(7),
    environment: "TEST",
    external_reference: null,
    amount_minor: 100,
    currency: "USD",
  };
  const { repo, query } = setup([
    [event],
    [],
    [{ id: id(5), order_id: id(6), cart_id: id(8) }],
    [{ id: id(8) }],
    [{ id: id(6) }],
    [attempt],
    [{ payment_attempt_id: id(5) }],
  ]);
  await expect(repo.apply(command)).resolves.toMatchObject({
    decision: "IGNORED",
    reasonCode: "NONTERMINAL_PAYMENT_OBSERVATION",
  });
  const lookup = query.mock.calls[2]?.[0];
  expect(lookup).toContain("WITH matched AS");
  expect(lookup).toContain("NOT EXISTS(SELECT 1 FROM matched)");
  expect(query.mock.calls[2]?.[1]).toContain(id(1));
});
test("refund evidence is left to the finance applier before comparing the payment capture amount", async () => {
  const { repo, query } = setup([
    [{ id: id(1), event_type: "REFUND_STATUS" }],
    [],
    [],
  ]);
  const result = await repo.apply(command);
  expect(result).toMatchObject({
    decision: "IGNORED",
    reasonCode: "NON_PAYMENT_EVENT",
  });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("UPDATE public.payment_attempts"),
    ),
  ).toBe(false);
});
