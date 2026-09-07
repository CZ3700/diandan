import { expect, test, vi } from "vitest";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";
const config = {
  host: "database.internal",
  port: 5432,
  database: "fan_support_test",
  user: "fan_support_test",
  password: "test-password",
} as const;
function pool() {
  const query = vi.fn(async (text: string) =>
    /^commit$/iu.test(text.trim()) ? { command: "COMMIT" } : { rows: [] },
  );
  return {
    query,
    connect: async () => ({ query, release: vi.fn() }),
    end: async () => {},
    on: () => {},
    off: () => {},
  };
}
test("SEO manager shares one SERIALIZABLE read lifecycle without changing existing managers", async () => {
  const source = pool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    () => source,
  );
  try {
    expect(persistence).toHaveProperty("storefrontSeoTransactionManager");
    expect(
      await persistence.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
        async (repositories) => Object.keys(repositories),
      ),
    ).toEqual(["storefrontSeo"]);
    expect(source.query).toHaveBeenCalledWith(
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
    );
    expect(
      await persistence.storefrontHomepageTransactionManager.runInStorefrontHomepageTransaction(
        async (repositories) => Object.keys(repositories),
      ),
    ).toEqual(["storefrontHomepage"]);
  } finally {
    await persistence.close();
  }
  await expect(
    persistence.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});
test("SEO configuration fails before acquiring any connection", async () => {
  const source = pool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    undefined,
    () => source,
  );
  try {
    expect(persistence).toHaveProperty("storefrontSeoTransactionManager");
    await expect(
      persistence.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
        async () => null,
      ),
    ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
    expect(source.query).not.toHaveBeenCalled();
  } finally {
    await persistence.close();
  }
});
