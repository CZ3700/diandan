import { expect, test, vi } from "vitest";
import { cartRuntimeCredentialCommandSchema } from "@fan-support/contracts";
import type { CartEditTransactionManager } from "@fan-support/persistence-port";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";

const config = {
  host: "database.internal",
  port: 5432,
  database: "fan_support_test",
  user: "fan_support_test",
  password: "test-password",
} as const;
function source() {
  const query = vi.fn(async (sql: string) =>
    /^commit$/iu.test(sql) ? { command: "COMMIT", rows: [] } : { rows: [] },
  );
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return {
    query,
    release,
    connect,
    end: async () => {},
    on: () => {},
    off: () => {},
  };
}
test("edit, cart, canonical commerce, idempotency and outbox share one SERIALIZABLE connection", async () => {
  const database = source();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    () => database,
  );
  try {
    expect(persistence).toHaveProperty("cartEditTransactionManager");
    const manager = (
      persistence as unknown as {
        cartEditTransactionManager: CartEditTransactionManager;
      }
    ).cartEditTransactionManager;
    const result = await manager.runInCartEditTransaction(
      async (repositories) => {
        await repositories.cartRuntime.findByCredentialForUpdate(
          cartRuntimeCredentialCommandSchema.parse({
            schemaVersion: 1,
            accesses: [
              {
                schemaVersion: 1,
                tokenDigest: "a".repeat(64),
                pepperVersion: "test-v1",
              },
            ],
          }),
        );
        await repositories.storefrontCommerce.readContext({ schemaVersion: 1 });
        return Object.keys(repositories);
      },
    );
    expect(result).toEqual([
      "cartEdit",
      "cartRuntime",
      "storefrontCommerce",
      "idempotency",
      "outbox",
    ]);
    expect(database.connect).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledWith(
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
    );
    expect(database.query).toHaveBeenCalledWith("COMMIT");
    expect(database.release).toHaveBeenCalledTimes(1);
  } finally {
    await persistence.close();
  }
});

test("a safe cart business rejection aborts the complete transaction", async () => {
  const database = source();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    () => database,
  );
  try {
    expect(persistence).toHaveProperty("cartEditTransactionManager");
    const manager = (
      persistence as unknown as {
        cartEditTransactionManager: CartEditTransactionManager;
      }
    ).cartEditTransactionManager;
    await expect(
      manager.runInCartEditTransaction(async ({ cartRuntime }) => {
        await cartRuntime.findByCredentialForUpdate({
          schemaVersion: 1,
          accesses: [],
        });
        return null;
      }),
    ).rejects.toMatchObject({
      name: "CartRuntimeRepositoryError",
      code: "INVALID_ACCESS",
    });
    expect(database.query).toHaveBeenCalledWith("ROLLBACK");
    expect(database.query).not.toHaveBeenCalledWith("COMMIT");
  } finally {
    await persistence.close();
  }
});

test("cart composition requires configured public media before opening a connection", async () => {
  const database = source();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    undefined,
    () => database,
  );
  try {
    expect(persistence).toHaveProperty("cartEditTransactionManager");
    const manager = (
      persistence as unknown as {
        cartEditTransactionManager: CartEditTransactionManager;
      }
    ).cartEditTransactionManager;
    await expect(
      manager.runInCartEditTransaction(async () => null),
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(database.connect).not.toHaveBeenCalled();
  } finally {
    await persistence.close();
  }
});
