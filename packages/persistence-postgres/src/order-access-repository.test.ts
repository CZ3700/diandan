import { expect, test, vi } from "vitest";
import {
  orderAccessBootstrapCommandSchema,
  orderAccessExchangeCommandSchema,
  orderAccessIssueCommandSchema,
  orderAccessReadCommandSchema,
  orderAccessRateCommandSchema,
} from "@fan-support/contracts";
import type { TransactionScopeControl } from "./transaction-runner.js";

const module = await import("./order-access-repository.js").catch(
  () => undefined,
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const credential = {
  schemaVersion: 1,
  tokenDigest: "a".repeat(64),
  pepperVersion: "test-v1",
};
const trace = {
  requestId: id(8),
  correlationId: id(9),
  taskName: "order-access-test",
};
const exchange = orderAccessExchangeCommandSchema.parse({
  schemaVersion: 1,
  tokenCandidates: [credential],
  sessionCredential: { ...credential, tokenDigest: "b".repeat(64) },
  sessionTtlSeconds: 900,
  ...trace,
});
const order = {
  id: id(1),
  cart_id: id(2),
  public_order_id: id(3),
  payment_status: "PAID",
  order_status: "OPEN",
  cart_status: "CONVERTED",
  cart_expired: false,
};
function setup(rows: unknown[][]) {
  expect(module).toBeDefined();
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: rows.shift() ?? [] }));
  const scope: TransactionScopeControl = {
    markRollbackOnly: vi.fn(),
    trackOperation: async (work) => work(),
  };
  return {
    query,
    repo: module!.createOrderAccessRepository(
      { query, release: vi.fn() },
      scope,
      "https://media.example.invalid/",
    ),
  };
}
test("unknown link credentials are rejected before acquiring aggregate locks or writing", async () => {
  const { repo, query } = setup([[]]);
  await expect(repo.exchange(exchange)).rejects.toMatchObject({
    code: "ACCESS_DENIED",
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).not.toMatch(/FOR UPDATE/u);
});
for (const token of [
  { status: "EXCHANGED", expired: false },
  { status: "REVOKED", expired: false },
  { status: "ACTIVE", expired: true },
  { status: "ACTIVE", expired: false, future: true },
]) {
  test(`link ${token.status}/${token.expired}/${token.future ?? false} cannot produce a new cookie`, async () => {
    const { repo, query } = setup([
      [{ order_id: id(1), cart_id: id(2) }],
      [{ id: id(2) }],
      [order],
      [{ id: id(4), future: false, ...token }],
    ]);
    await expect(repo.exchange(exchange)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
    expect(
      query.mock.calls.every(([sql]) => !/^(INSERT|UPDATE)/u.test(sql.trim())),
    ).toBe(true);
    expect(query.mock.calls[1]?.[0]).toMatch(/public\.carts[\s\S]*FOR UPDATE/u);
    expect(query.mock.calls[2]?.[0]).toMatch(
      /public\.orders[\s\S]*FOR UPDATE/u,
    );
    expect(query.mock.calls[3]?.[0]).toMatch(
      /public\.order_access_tokens[\s\S]*FOR UPDATE/u,
    );
  });
}
test("internal issuance cannot grant access to an unpaid aggregate", async () => {
  const { repo, query } = setup([
    [{ cart_id: id(2) }],
    [{ id: id(2) }],
    [{ ...order, payment_status: "PENDING", order_status: "PENDING_PAYMENT" }],
  ]);
  await expect(
    repo.issue(
      orderAccessIssueCommandSchema.parse({
        schemaVersion: 1,
        orderId: id(1),
        tokenCredential: credential,
        linkTtlSeconds: 3600,
        ...trace,
      }),
    ),
  ).rejects.toMatchObject({ code: "PAYMENT_NOT_CONFIRMED" });
  expect(
    query.mock.calls.every(([sql]) => !/^(INSERT|UPDATE)/u.test(sql.trim())),
  ).toBe(true);
});
test("checkout bootstrap refuses an expired cart even when it was converted", async () => {
  const { repo, query } = setup([
    [
      {
        id: id(2),
        version: "4",
        status: "CONVERTED",
        expired: true,
        presentation_locale: "en",
        market: "TEST",
        currency: "USD",
        expires_at: "2026-01-01T00:00:00Z",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-02-01T00:00:00Z",
      },
    ],
  ]);
  await expect(
    repo.bootstrap(
      orderAccessBootstrapCommandSchema.parse({
        schemaVersion: 1,
        checkoutSessionId: id(5),
        cartAccesses: [credential],
        tokenCredential: credential,
        sessionCredential: { ...credential, tokenDigest: "b".repeat(64) },
        sessionTtlSeconds: 900,
        ...trace,
      }),
    ),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(query).toHaveBeenCalledTimes(1);
});
test("public order ID alone cannot read an order", async () => {
  const { repo, query } = setup([[]]);
  await expect(
    repo.read(
      orderAccessReadCommandSchema.parse({
        schemaVersion: 1,
        publicOrderId: id(3),
        sessionCandidates: [credential],
      }),
    ),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(query).toHaveBeenCalledTimes(1);
});

test("checkout bootstrap consumes an internal grant without retiring a pending notification link", async () => {
  const { repo, query } = setup([]);
  query.mockImplementation(async (sql) => {
    if (sql.includes("current_access_valid"))
      return { rows: [{ current_access_valid: true }] };
    if (sql.includes("FROM public.carts"))
      return {
        rows: [
          {
            id: id(2),
            version: "4",
            status: "CONVERTED",
            expired: false,
            presentation_locale: "en",
            market: "TEST",
            currency: "USD",
            expires_at: "2026-09-17T00:00:00Z",
            created_at: "2026-09-16T00:00:00Z",
            updated_at: "2026-09-16T00:00:00Z",
          },
        ],
      };
    if (sql.includes("FROM public.orders")) return { rows: [order] };
    if (sql.includes("INSERT INTO public.order_access_tokens"))
      return { rows: [{ id: id(4), expires_at: "2026-09-17T00:00:00Z" }] };
    if (sql.includes("exchanged_at=instant.now"))
      return { rows: [{ id: id(4), exchanged_at: "2026-09-16T00:00:00Z" }] };
    if (sql.includes("INSERT INTO public.order_access_sessions"))
      return { rows: [{ id: id(5), expires_at: "2026-09-17T00:00:00Z" }] };
    return { rows: [] };
  });
  await expect(
    repo.bootstrap(
      orderAccessBootstrapCommandSchema.parse({
        schemaVersion: 1,
        checkoutSessionId: id(5),
        cartAccesses: [credential],
        tokenCredential: credential,
        sessionCredential: { ...credential, tokenDigest: "b".repeat(64) },
        sessionTtlSeconds: 900,
        ...trace,
      }),
    ),
  ).resolves.toMatchObject({ publicOrderId: order.public_order_id });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("UPDATE public.order_access_tokens token SET status=CASE"),
    ),
  ).toBe(false);
  const insert = query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO public.order_access_tokens"),
  );
  expect(insert?.[1]).toContain("CHECKOUT_BOOTSTRAP");
});
test("rate-limit consumers use one parameterized statement and return a bounded denial", async () => {
  const { repo, query } = setup([[{ allowed: false, retry_after_seconds: 7 }]]);
  await expect(
    repo.consumeRateLimit(
      orderAccessRateCommandSchema.parse({
        schemaVersion: 1,
        scope: "EXCHANGE",
        bucket: credential,
        windowSeconds: 60,
        maxRequests: 10,
      }),
    ),
  ).resolves.toEqual({
    schemaVersion: 1,
    allowed: false,
    retryAfterSeconds: 7,
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT");
  expect(query.mock.calls[0]?.[0]).not.toContain(credential.tokenDigest);
});

for (const phase of ["AFTER_LOCKS", "BEFORE_GRANT"] as const) {
  test(`checkout bootstrap rechecks actual cart expiry ${phase}`, async () => {
    const { repo, query } = setup([]);
    let timeChecks = 0;
    query.mockImplementation(async (sql) => {
      if (sql.includes("current_access_valid")) {
        timeChecks++;
        return {
          rows: [
            {
              current_access_valid:
                phase === "BEFORE_GRANT" && timeChecks === 1,
            },
          ],
        };
      }
      if (sql.includes("FROM public.carts"))
        return {
          rows: [
            {
              id: id(2),
              version: "4",
              status: "CONVERTED",
              expired: false,
              presentation_locale: "en",
              market: "TEST",
              currency: "USD",
              expires_at: "2026-01-01T00:00:00Z",
              created_at: "2025-01-01T00:00:00Z",
              updated_at: "2025-02-01T00:00:00Z",
            },
          ],
        };
      if (sql.includes("FROM public.orders")) return { rows: [order] };
      if (sql.includes("INSERT INTO public.order_access_tokens"))
        return { rows: [{ id: id(4), expires_at: "2026-01-01T01:00:00Z" }] };
      if (sql.includes("exchanged_at=instant.now"))
        return { rows: [{ id: id(4), exchanged_at: "2026-01-01T00:00:00Z" }] };
      if (sql.includes("INSERT INTO public.order_access_sessions"))
        return { rows: [{ id: id(5), expires_at: "2026-01-01T01:00:00Z" }] };
      return { rows: [] };
    });
    await expect(
      repo.bootstrap(
        orderAccessBootstrapCommandSchema.parse({
          schemaVersion: 1,
          checkoutSessionId: id(5),
          cartAccesses: [credential],
          tokenCredential: credential,
          sessionCredential: { ...credential, tokenDigest: "b".repeat(64) },
          sessionTtlSeconds: 900,
          ...trace,
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(timeChecks).toBe(phase === "AFTER_LOCKS" ? 1 : 2);
    if (phase === "AFTER_LOCKS")
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes("INSERT INTO public.order_access_tokens"),
        ),
      ).toBe(false);
  });
}
