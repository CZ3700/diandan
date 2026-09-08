import { expect, test, vi } from "vitest";
import { createPostgresPersistenceWithPoolFactory } from "./postgres-persistence.js";
const config = {
  host: "database.internal",
  port: 5432,
  database: "fixture",
  user: "fixture",
  password: "test-password",
};
test("management publication and media use shared serializable repositories and stop with the owner", async () => {
  const query = vi.fn(async (sql: string) =>
    sql === "COMMIT" ? { command: "COMMIT", rows: [] } : { rows: [] },
  );
  const pool = {
    connect: async () => ({ query, release: vi.fn() }),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
    () => pool,
  );
  expect(persistence).toHaveProperty("managementCenterTransactionManager");
  expect(persistence).toHaveProperty("managementMediaTransactionManager");
  expect(
    await persistence.managementCenterTransactionManager.runInManagementCenterTransaction(
      async (repos) => Object.keys(repos).sort(),
    ),
  ).toEqual(["operations", "publication"]);
  expect(
    await persistence.managementMediaTransactionManager.runInManagementMediaTransaction(
      async (repos) => Object.keys(repos).sort(),
    ),
  ).toEqual(["operations", "publication", "resources"]);
  expect(query).toHaveBeenCalledWith("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.managementCenterTransactionManager.runInManagementCenterTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
  await expect(
    persistence.managementMediaTransactionManager.runInManagementMediaTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});
