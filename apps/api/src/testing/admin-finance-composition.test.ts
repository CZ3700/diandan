import { expect, test, vi } from "vitest";
const module = await import("./admin-finance-composition.js").catch(
  () => undefined,
);
const options = {
  environment: "LOCAL_OIDC",
  database: {
    host: "127.0.0.1",
    port: 5432,
    database: "test",
    user: "test",
    password: "test",
  },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "https://admin.example.invalid",
  providers: [],
  leaseMs: 1000,
  retryAfterMs: 1000,
} as const;
test("finance composition drives durable evidence even with an empty recovery queue and closes its pool", async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => undefined),
    claim = vi.fn(async () => null),
    listPending = vi.fn(async () => ({
      schemaVersion: 1,
      providerEventIds: [],
    }));
  const transactions = {
    runInAdminFinanceTransaction: vi.fn(
      async (work: (repo: unknown) => Promise<unknown>) =>
        work({ claim, listPending }),
    ),
  };
  expect(module?.createLocalAdminFinanceComposition).toBeTypeOf("function");
  const composition = module!.createLocalAdminFinanceComposition(options, {
    createPersistence: () =>
      ({ adminFinanceTransactionManager: transactions, close }) as never,
  });
  try {
    await composition.adminFinanceRuntime.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(listPending).toHaveBeenCalledTimes(1);
    await composition.adminFinanceRuntime.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
test("finance composition rejects invalid origins before creating infrastructure", () => {
  const createPersistence = vi.fn();
  expect(module?.createLocalAdminFinanceComposition).toBeTypeOf("function");
  expect(() =>
    module!.createLocalAdminFinanceComposition(
      { ...options, allowedOrigin: "http://admin.example.invalid" },
      { createPersistence },
    ),
  ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
