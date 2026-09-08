import { expect, test, vi } from "vitest";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";

const config = {
  host: "database.internal",
  port: 5432,
  database: "fan_support_test",
  user: "fan_support_test",
  password: "test-password",
};
function setup() {
  const query = vi.fn(async (sql: string) =>
    /^commit$/iu.test(sql) ? { command: "COMMIT", rows: [] } : { rows: [] },
  );
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
    end: async () => {},
    on: () => {},
    off: () => {},
  };
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    () => pool,
  );
  return { query, release, pool, persistence };
}
test("checkout repositories use one SERIALIZABLE transaction and roll back a failed callback", async () => {
  const f = setup();
  try {
    expect(f.persistence).toHaveProperty("checkoutPreflightTransactionManager");
    const manager = f.persistence.checkoutPreflightTransactionManager;
    const failure = new Error("TEST_CALLBACK_FAILURE");
    await expect(
      manager.runInCheckoutPreflightTransaction(async (repos) => {
        expect(Object.keys(repos).sort()).toEqual([
          "cartRuntime",
          "checkoutPreflight",
          "idempotency",
          "inventory",
          "outbox",
        ]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT");
  } finally {
    await f.persistence.close();
  }
});
