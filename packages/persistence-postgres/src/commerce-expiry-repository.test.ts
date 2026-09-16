import { expect, test, vi } from "vitest";
import type { InventoryRepository } from "@fan-support/persistence-port";
import type { TransactionScopeControl } from "./transaction-runner.js";

const module = await import("./commerce-expiry-repository.js").catch(
  () => undefined,
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = {
  schemaVersion: 1 as const,
  cartId: id(1),
  requestId: id(2),
  correlationId: id(3),
  taskName: "commerce-expiry-test",
};

function setup(rows: unknown[][] = []) {
  expect(
    module,
    "commerce expiry repository must be implemented",
  ).toBeDefined();
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: rows.shift() ?? [] }));
  const inventory = {
    loadManyForUpdate: vi.fn(),
    applyReservationTransition: vi.fn(),
  };
  const scope: TransactionScopeControl = {
    markRollbackOnly: vi.fn(),
    trackOperation: async (work) => work(),
  };
  return {
    query,
    inventory,
    repository: module!.createCommerceExpiryRepository(
      { query, release: vi.fn() },
      inventory as unknown as InventoryRepository,
      scope,
    ),
  };
}

test("empty due scans do not mutate or acquire reservation locks", async () => {
  const { repository, query, inventory } = setup();
  await expect(
    repository.listDue({ schemaVersion: 1, limit: 10 }),
  ).resolves.toEqual({
    schemaVersion: 1,
    cartIds: [],
  });
  expect(query.mock.calls).toHaveLength(1);
  expect(query.mock.calls[0]?.[0]).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/u);
  expect(inventory.loadManyForUpdate).not.toHaveBeenCalled();
});

test("a skipped aggregate cannot expire inventory or private intent rows", async () => {
  const { repository, query, inventory } = setup();
  await expect(repository.expireCart(command)).resolves.toMatchObject({
    decision: "BUSY",
  });
  expect(query.mock.calls).toHaveLength(1);
  expect(query.mock.calls[0]?.[0]).toMatch(
    /public\.carts[\s\S]*FOR UPDATE[\s\S]*SKIP LOCKED/u,
  );
  expect(inventory.applyReservationTransition).not.toHaveBeenCalled();
});

for (const [label, invalid] of [
  ["invalid cart ID", { ...command, cartId: "not-a-cart-id" }],
  ["future cutoff", { ...command, expiresAt: "2099-01-01T00:00:00Z" }],
  ["force", { ...command, force: true }],
] as const) {
  test(`expiry rejects caller-supplied authority ${label}`, async () => {
    const { repository, query, inventory } = setup();
    await expect(repository.expireCart(invalid as never)).rejects.toMatchObject(
      {
        code: "INVALID_COMMAND",
      },
    );
    expect(query).not.toHaveBeenCalled();
    expect(inventory.applyReservationTransition).not.toHaveBeenCalled();
  });
}

for (const limit of [0, 101, 1.5]) {
  test(`due scans reject invalid batch size ${limit}`, async () => {
    const { repository, query } = setup();
    await expect(
      repository.listDue({ schemaVersion: 1, limit }),
    ).rejects.toMatchObject({
      code: "INVALID_COMMAND",
    });
    expect(query).not.toHaveBeenCalled();
  });
}

const cart = {
  id: id(1),
  status: "ACTIVE",
  locked_order_id: null,
  version: 1,
  due: true,
  clock_valid: true,
  at: "2026-09-16T00:00:00.123456Z",
};
const order = {
  id: id(4),
  cart_id: id(1),
  checkout_session_id: id(5),
  version: 3,
  due: true,
  clock_valid: true,
  order_status: "PENDING_PAYMENT",
  payment_status: "PENDING",
  current_payment_attempt_id: id(6),
  dispute_status: "NONE",
  fulfillment_status: "PENDING",
};
const intent = { id: id(7), status: "CHECKOUT_LOCKED", clock_valid: true };
const writeSql = (calls: ReturnType<typeof setup>["query"]["mock"]["calls"]) =>
  calls.filter(([sql]) => /^(UPDATE|INSERT|DELETE)/u.test(sql.trim()));

for (const current of [
  { ...cart, due: false },
  { ...cart, clock_valid: false },
  { ...cart, status: "EXPIRED" },
])
  test(`ineligible cart ${current.status}/${current.due}/${current.clock_valid} is a no-op`, async () => {
    const { repository, query, inventory } = setup([[current]]);
    const result = await repository.expireCart(command);
    expect(result.expiredCart).toBe(false);
    expect(writeSql(query.mock.calls)).toEqual([]);
    expect(inventory.loadManyForUpdate).not.toHaveBeenCalled();
  });

test("an expired active cart preserves canceled lines and all encrypted material", async () => {
  const { repository, query } = setup([
    [cart],
    [
      { ...intent, status: "ACTIVE", due: true, ordered: false },
      { ...intent, id: id(8), status: "CANCELED", due: true, ordered: false },
    ],
    [{ id: id(7) }],
    [{ id: id(1) }],
  ]);
  await expect(repository.expireCart(command)).resolves.toMatchObject({
    decision: "APPLIED",
    expiredCart: true,
    expiredIntents: 1,
    canceledIntents: 0,
  });
  expect(
    writeSql(query.mock.calls)
      .map(([sql]) => sql)
      .join(" "),
  ).not.toMatch(/DELETE|ciphertext|encrypted_data_key|privacy_state/u);
  expect(
    query.mock.calls.filter(([sql]) =>
      sql.startsWith("UPDATE public.support_intents"),
    )[0]?.[0],
  ).toContain("status='ACTIVE'");
});

for (const status of ["CREATED", "REQUIRES_ACTION", "PROCESSING", "SUCCEEDED"])
  test(`${status} payment is never canceled or expired by the sweeper`, async () => {
    const { repository, query, inventory } = setup([
      [{ ...cart, status: "LOCKED", locked_order_id: id(4) }],
      [order],
      [{ id: id(6), status, clock_valid: true }],
      [{ count: 1 }],
    ]);
    await expect(repository.expireCart(command)).resolves.toMatchObject({
      decision: "DEFERRED",
      canceledOrders: 0,
      expiredReservations: 0,
    });
    expect(
      writeSql(query.mock.calls).every(([sql]) =>
        sql.includes("order_access_"),
      ),
    ).toBe(true);
    expect(inventory.loadManyForUpdate).not.toHaveBeenCalled();
  });

test("an UNKNOWN checkout remains locked when no reservation is due", async () => {
  const { repository, query } = setup([
    [{ ...cart, status: "LOCKED", locked_order_id: id(4) }],
    [order],
    [{ id: id(6), status: "UNKNOWN", clock_valid: true }],
    [{ count: 1 }],
    [intent],
    [{ id: id(5), status: "PAYMENT_PENDING", clock_valid: true }],
    [],
  ]);
  await expect(repository.expireCart(command)).resolves.toMatchObject({
    canceledOrders: 0,
    canceledIntents: 0,
    expiredCart: false,
    expiredReservations: 0,
  });
  expect(
    writeSql(query.mock.calls).every(([sql]) => sql.includes("order_access_")),
  ).toBe(true);
});

test("contested attempts are skipped before any inventory or intent mutation", async () => {
  const { repository, query, inventory } = setup([
    [{ ...cart, status: "LOCKED", locked_order_id: id(4) }],
    [order],
    [],
    [{ count: 1 }],
  ]);
  await expect(repository.expireCart(command)).resolves.toMatchObject({
    decision: "BUSY",
  });
  expect(writeSql(query.mock.calls)).toEqual([]);
  expect(inventory.loadManyForUpdate).not.toHaveBeenCalled();
});

for (const status of [null, "FAILED", "CANCELED", "EXPIRED"])
  test(`only a due checkout with ${status ?? "no"} attempt is canceled atomically`, async () => {
    const candidate = {
      ...order,
      current_payment_attempt_id: status ? id(6) : null,
      payment_status: status ? "PENDING" : "UNPAID",
    };
    const { repository, query } = setup([
      [{ ...cart, status: "LOCKED", locked_order_id: id(4) }],
      [candidate],
      status ? [{ id: id(6), status, clock_valid: true }] : [],
      [{ count: status ? 1 : 0 }],
      [intent],
      [
        {
          id: id(5),
          status: status ? "PAYMENT_PENDING" : "READY",
          clock_valid: true,
        },
      ],
      [],
      [{ count: 0 }],
      [{ id: id(7) }],
      [{ id: id(5) }],
      [{ id: id(1) }],
      [],
      [{ id: id(4) }],
    ]);
    await expect(repository.expireCart(command)).resolves.toMatchObject({
      decision: "APPLIED",
      canceledOrders: 1,
      canceledIntents: 1,
      expiredCheckoutSessions: 1,
      expiredCart: true,
    });
    const writes = writeSql(query.mock.calls);
    expect(writes.map(([sql]) => sql).join(" ")).not.toMatch(
      /DELETE|UPDATE public\.payment_attempts|UPDATE public\.order_items/u,
    );
    const event = writes.find(([sql]) =>
      sql.startsWith("INSERT INTO public.order_events"),
    );
    expect(event?.[1]).toContain("SYSTEM");
    expect(event?.[1]).toContain("CHECKOUT_QUOTE_EXPIRED");
  });
