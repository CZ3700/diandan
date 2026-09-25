import { expect, test, vi } from "vitest";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
import { createTransactionRunner } from "./transaction-runner.js";
import { createResourceRun } from "./resource-management-data.js";

test("actual resource validation failure is classified only after complete transaction rollback", async () => {
  const statements: string[] = [];
  const client = {
    query: async (text: string) => {
      statements.push(text);
      return { command: text };
    },
    release: vi.fn(),
  };
  const runner = createTransactionRunner({
    acquireClient: async () => client,
    createRepositories: (connection, scope) => ({
      run: createResourceRun(connection, scope),
    }),
  });
  const result = runner.run(
    { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
    async ({ run }) =>
      run(async () => {
        throw new Error("validation failed");
      }),
  );
  await expect(result).rejects.toBeInstanceOf(
    PersistenceTransactionFailureError,
  );
  await expect(result).rejects.toMatchObject({
    code: "UNEXPECTED_ADAPTER_FAILURE",
    recovery: "RETRY_SAME_COMMAND",
  });
  expect(statements).toEqual([
    "BEGIN ISOLATION LEVEL SERIALIZABLE",
    "SET LOCAL search_path = pg_catalog, public",
    "SAVEPOINT resource_management_1",
    "ROLLBACK TO SAVEPOINT resource_management_1",
    "RELEASE SAVEPOINT resource_management_1",
    "ROLLBACK",
  ]);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test.each([new Error("connection lost during commit"), { code: "08006" }])(
  "actual COMMIT ambiguity stays RECONCILE_REQUIRED after rollback cleanup",
  async (commitError) => {
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        if (text === "COMMIT") throw commitError;
        return { command: text };
      },
      release: vi.fn(),
    };
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({}),
    });
    const result = runner.run(
      { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
      async () => ({ schemaVersion: 1, published: true }),
    );
    await expect(result).rejects.toBeInstanceOf(
      PersistenceTransactionFailureError,
    );
    await expect(result).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  },
);
