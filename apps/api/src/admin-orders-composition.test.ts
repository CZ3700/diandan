import { expect, test, vi } from "vitest";
const module = await import("./admin-orders-composition.js").catch(
  () => undefined,
);
const options = {
  environment: "LOCAL_OIDC" as const,
  database: {
    schemaVersion: 1 as const,
    maxConnections: 2,
    connectionString: "postgres://local:local@localhost:5432/test",
  },
  allowedOrigin: "https://admin.example.invalid",
  publicMediaBaseUrl: "https://media.example.invalid",
  tokenPepper: "a".repeat(64),
  keys: { encryptEnvelope: vi.fn(), decryptEnvelope: vi.fn() } as never,
};
test("local orders composition owns one PG pool and borrows key service with idempotent cleanup", async () => {
  expect(module?.createLocalAdminOrdersComposition).toBeTypeOf("function");
  const close = vi.fn(async () => {}),
    runInAdminOrdersTransaction = vi.fn(async () => {
      throw new Error("Unused composition fixture transaction");
    });
  const createPersistence = vi.fn(() => ({
    adminOrdersTransactionManager: { runInAdminOrdersTransaction },
    close,
  }));
  const composition = module!.createLocalAdminOrdersComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledWith(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  expect(composition.adminOrdersRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.adminOrdersRuntime.start();
  await Promise.all([
    composition.adminOrdersRuntime.stop(),
    composition.adminOrdersRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledOnce();
});
test("unsafe local configuration fails before resource allocation", () => {
  expect(module?.createLocalAdminOrdersComposition).toBeTypeOf("function");
  for (const patch of [
    { environment: "PRODUCTION" },
    { allowedOrigin: "http://admin.example.invalid" },
    { allowedOrigin: "https://admin.example.invalid/path" },
    { publicMediaBaseUrl: "http://media.example.invalid" },
    { tokenPepper: "weak" },
    { keys: {} },
  ]) {
    const createPersistence = vi.fn();
    expect(() =>
      module!.createLocalAdminOrdersComposition(
        { ...options, ...patch } as never,
        { createPersistence },
      ),
    ).toThrow();
    expect(createPersistence).not.toHaveBeenCalled();
  }
});
