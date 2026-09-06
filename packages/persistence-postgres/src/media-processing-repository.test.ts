import { describe, expect, test, vi } from "vitest";
import { mediaProcessingEnqueueCommandSchema } from "@fan-support/contracts";
import { createMediaProcessingRepository } from "./media-processing-repository.js";
import { createTransactionRunner } from "./transaction-runner.js";

const jobId = "10000000-0000-4000-8000-000000000001";
const enqueue = mediaProcessingEnqueueCommandSchema.parse({
  schemaVersion: 1,
  jobId,
  sourceAssetId: "10000000-0000-4000-8000-000000000002",
  metadataRevisionId: "10000000-0000-4000-8000-000000000003",
  requestedBy: "10000000-0000-4000-8000-000000000004",
  reason: "Prepare reviewed image framing",
  role: "PORTRAIT",
  fit: "COVER",
});
function harness(fail = false) {
  const query = vi.fn(async (sql: string) => {
    if (fail && sql.includes("SELECT"))
      throw new Error("private database credential must never escape");
    return { rows: [] };
  });
  return {
    query,
    repository: createMediaProcessingRepository(
      { query, release: () => undefined },
      {
        markRollbackOnly: vi.fn(),
        trackOperation: async (operation) => operation(),
      },
    ),
  };
}
describe("media processing repository", () => {
  test("reports a PostgreSQL serialization failure inside enqueue as an explicit conflict", async () => {
    const query = async (sql: string) => {
      if (sql.includes("media-processing:canonical-source"))
        throw Object.assign(new Error("synthetic serialization failure"), {
          code: "40001",
        });
      return { rows: [] };
    };
    const repository = createMediaProcessingRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    );
    expect(await repository.enqueue(enqueue)).toMatchObject({
      outcome: "FAILURE",
      code: "CONFLICT",
    });
  });
  test("the actual transaction runner rolls back even when the caller catches a boundary failure", async () => {
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith("RELEASE"))
        throw new Error("lost savepoint acknowledgement");
      return { rows: [], command: sql.split(" ")[0] };
    };
    const runner = createTransactionRunner({
      acquireClient: async () => ({ query, release: () => undefined }),
      createRepositories: (client, scope) =>
        createMediaProcessingRepository(client, scope),
    });
    await expect(
      runner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repository) => {
          try {
            await repository.read({ schemaVersion: 1, jobId });
          } catch {
            /* Caller cannot clear tracked failure. */
          }
          return { schemaVersion: 1, outcome: "SUCCESS" };
        },
      ),
    ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
  test.each(["SAVEPOINT", "ROLLBACK TO", "RELEASE"])(
    "rejects the tracked operation when %s fails",
    async (prefix) => {
      const markRollbackOnly = vi.fn();
      const repository = createMediaProcessingRepository(
        {
          release: () => undefined,
          query: async (sql) => {
            if (sql.startsWith(prefix)) throw new Error("boundary failure");
            return { rows: [] };
          },
        },
        { markRollbackOnly, trackOperation: async (operation) => operation() },
      );
      await expect(
        repository.read({ schemaVersion: 1, jobId }),
      ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
    },
  );
  test("rejects unversioned or enriched input before database access", async () => {
    const { query, repository } = harness();
    expect(
      await repository.enqueue({ ...enqueue, width: 999 } as typeof enqueue),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(query).not.toHaveBeenCalled();
  });
  test("does not queue an absent canonical source", async () => {
    expect(await harness().repository.enqueue(enqueue)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "SOURCE_NOT_ELIGIBLE",
    });
  });
  test("reports a missing job without fabricating a snapshot", async () => {
    expect(
      await harness().repository.read({ schemaVersion: 1, jobId }),
    ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" });
  });
  test("claims an empty queue without a fake lease", async () => {
    expect(
      await harness().repository.claim({
        schemaVersion: 1,
        leaseToken: jobId,
        leaseSeconds: 60,
      }),
    ).toEqual({ schemaVersion: 1, outcome: "EMPTY" });
  });
  test("normalizes database failures without driver details", async () => {
    const result = await harness(true).repository.read({
      schemaVersion: 1,
      jobId,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("credential");
  });
});
