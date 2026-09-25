import { describe, expect, it, vi } from "vitest";
import { createResourceManagementRepository } from "./resource-management-repository.js";
import { createResourceAuthorizationRepository } from "./resource-authorization-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
import { createPersistenceTransactionFailureError } from "./transaction-runner.js";
import { createResourceRun } from "./resource-management-data.js";

const scope = {
  trackOperation: <Result>(work: () => Promise<Result>) => work(),
} as TransactionScopeControl;
describe("resource management persistence boundary", () => {
  it.each(["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const)(
    "preserves a nested canonical %s transaction failure",
    async (code) => {
      const query = vi.fn<(sql: string) => Promise<{ rows: never[] }>>(
        async () => ({ rows: [] }),
      );
      const run = createResourceRun({ query, release: vi.fn() }, scope);
      const failure = createPersistenceTransactionFailureError(
        code === "TRANSACTION_ABORTED"
          ? { code, recovery: "RETRY_SAME_COMMAND", retryAfterMs: 250 }
          : { code, recovery: "NONE" },
      );
      await expect(
        run(async () => {
          throw failure;
        }),
      ).rejects.toMatchObject({ code });
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).startsWith("ROLLBACK TO SAVEPOINT"),
        ),
      ).toBe(true);
    },
  );
  it.each([
    "readPolicy",
    "registerPolicy",
    "reserveUpload",
    "readUpload",
    "registerUpload",
    "readMedia",
    "setRights",
    "enqueueMedia",
    "readMediaJob",
    "retryMediaJob",
  ] as const)(
    "rejects malformed %s before querying PostgreSQL",
    async (method) => {
      const query = vi.fn();
      const repository = createResourceManagementRepository(
        { query, release: vi.fn() },
        scope,
      );
      expect(await repository[method]({} as never)).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
      expect(query).not.toHaveBeenCalled();
    },
  );
  it("does not interpret a resource permission as arbitrary SQL or a locale grant", async () => {
    const query = vi.fn();
    const repository = createResourceAuthorizationRepository(
      { query, release: vi.fn() },
      scope,
    );
    expect(
      await repository.authorize({
        schemaVersion: 1,
        permission: "content.edit",
        sessionTokenDigest: "a".repeat(64),
        csrfTokenDigest: "b".repeat(64),
      } as never),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
