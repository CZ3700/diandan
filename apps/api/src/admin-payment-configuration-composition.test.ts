import { expect, test, vi } from "vitest";
const module =
  await import("./admin-payment-configuration-composition.js").catch(
    () => undefined,
  );
const options = {
  environment: "LOCAL_OIDC" as const,
  database: {
    host: "127.0.0.1",
    port: 5432,
    database: "test",
    user: "test",
    password: "test",
  },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "https://admin.example.invalid",
  connections: [],
  factories: [],
  healthPolicies: [],
  refreshDelayMs: 1000,
};
test("configuration composition reads independent PG projections and closes its own pool", async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => undefined),
    readPublished = vi.fn(async () => null);
  expect(module?.createLocalAdminPaymentConfigurationComposition).toBeTypeOf(
    "function",
  );
  const composition = module!.createLocalAdminPaymentConfigurationComposition(
    options,
    {
      createPersistence: () =>
        ({
          close,
          adminPaymentConfigurationTransactionManager: {
            runInAdminPaymentConfigurationTransaction: async (
              work: (repo: unknown) => Promise<unknown>,
            ) => work({ readPublished }),
          },
        }) as never,
    },
  );
  try {
    await composition.adminPaymentConfigurationRuntime.start();
    expect(readPublished).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readPublished).toHaveBeenCalledTimes(2);
    await composition.adminPaymentConfigurationRuntime.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(close).toHaveBeenCalledOnce();
    expect(readPublished).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
test("configuration composition rejects untrusted origins before opening infrastructure", () => {
  const createPersistence = vi.fn();
  expect(module?.createLocalAdminPaymentConfigurationComposition).toBeTypeOf(
    "function",
  );
  expect(() =>
    module!.createLocalAdminPaymentConfigurationComposition(
      { ...options, allowedOrigin: "http://admin.example.invalid" },
      { createPersistence },
    ),
  ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
test("configuration pool bounds connections and queries even when deployment defaults are unbounded", async () => {
  const createPersistence = vi.fn(() => ({
    close: async () => undefined,
    adminPaymentConfigurationTransactionManager: {
      runInAdminPaymentConfigurationTransaction: vi.fn(),
    },
  }));
  expect(module?.createLocalAdminPaymentConfigurationComposition).toBeTypeOf(
    "function",
  );
  const result = module!.createLocalAdminPaymentConfigurationComposition(
    {
      ...options,
      database: {
        ...options.database,
        connectionTimeoutMillis: 0,
        statement_timeout: 0,
        query_timeout: 0,
      },
    },
    { createPersistence },
  );
  expect(createPersistence).toHaveBeenCalledWith({
    ...options.database,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  await result.adminPaymentConfigurationRuntime.stop();
});
