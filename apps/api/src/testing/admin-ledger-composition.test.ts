import { expect, test, vi } from "vitest";
import { createLocalAdminLedgerComposition } from "./admin-ledger-composition.js";

const options = {
  environment: "LOCAL_OIDC" as const,
  database: {
    schemaVersion: 1 as const,
    maxConnections: 2,
    connectionString: "postgres://local:local@localhost:5432/test",
  },
  allowedOrigin: "https://admin.example.invalid",
  tokenPepper: "a".repeat(64),
  keys: { encryptEnvelope: vi.fn(), decryptEnvelope: vi.fn() } as never,
};

test("the local ledger composition owns one pool, borrows the key service and closes once", async () => {
  const close = vi.fn(async () => {}),
    runInAdminLedgerTransaction = vi.fn();
  const createPersistence = vi.fn(() => ({
    adminLedgerTransactionManager: { runInAdminLedgerTransaction },
    close,
  }));
  const composition = createLocalAdminLedgerComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledTimes(1);
  expect(composition.adminLedgerRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.adminLedgerRuntime.start();
  await Promise.all([
    composition.adminLedgerRuntime.stop(),
    composition.adminLedgerRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});

test("unsafe origins, peppers or time zones never build a ledger", () => {
  const createPersistence = vi.fn(() => ({
    adminLedgerTransactionManager: { runInAdminLedgerTransaction: vi.fn() },
    close: vi.fn(async () => {}),
  }));
  for (const bad of [
    { allowedOrigin: "http://admin.example.invalid" },
    { tokenPepper: "short" },
    { environment: "PRODUCTION" },
  ])
    expect(() =>
      createLocalAdminLedgerComposition({ ...options, ...bad } as never, {
        createPersistence,
      }),
    ).toThrow(TypeError);
  expect(() =>
    createLocalAdminLedgerComposition(
      { ...options, timeZone: "Mars/Olympus" },
      { createPersistence },
    ),
  ).toThrow(TypeError);
  expect(createPersistence).toHaveBeenCalledTimes(1);
});
