import { describe, expect, test, vi } from "vitest";
import { createContentDraftRepository } from "./content-draft-repository.js";
import { createTransactionRunner } from "./transaction-runner.js";

const revisionId = "10000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: 1 as const,
  id: "10000000-0000-4000-8000-000000000002",
  idolRevisionId: revisionId,
  aliases: [],
  actorId: "10000000-0000-4000-8000-000000000003",
  reasonCode: "CONTENT_CREATED",
  requestId: "10000000-0000-4000-8000-000000000004",
};
function harness(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createContentDraftRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}
describe("content draft repository", () => {
  test("rejects client approval and unversioned reads before querying", async () => {
    const { query, repository } = harness();
    expect(
      await repository.createIdolAliases({
        ...command,
        review: { status: "APPROVED" },
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(
      await repository.read({
        kind: "IDOL_ALIASES",
        idolRevisionId: revisionId,
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(query).not.toHaveBeenCalled();
  });
  test("requires an available canonical editor", async () => {
    const { query, repository } = harness();
    expect(await repository.createIdolAliases(command as never)).toMatchObject({
      code: "ACTOR_UNAVAILABLE",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  test("requires an existing DRAFT parent", async () => {
    expect(
      await harness([[{ id: command.actorId }]]).repository.createIdolAliases(
        command as never,
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await harness([
        [{ id: command.actorId }],
        [{ lifecycle: "VALIDATED" }],
      ]).repository.createIdolAliases(command as never),
    ).toMatchObject({ code: "REVISION_NOT_DRAFT" });
  });
  test("does not overwrite an existing immutable extension", async () => {
    const { query, repository } = harness([
      [{ id: command.actorId }],
      [{ lifecycle: "DRAFT" }],
      [{ id: command.id }],
    ]);
    expect(await repository.createIdolAliases(command as never)).toMatchObject({
      code: "ALREADY_EXISTS",
    });
    expect(query.mock.calls.flat().join(" ")).not.toContain("INSERT");
  });
  test("missing drafts remain missing", async () => {
    expect(
      await harness().repository.read({
        schemaVersion: 1,
        kind: "IDOL_ALIASES",
        idolRevisionId: revisionId,
      } as never),
    ).toMatchObject({ code: "NOT_FOUND" });
  });
  test("a swallowed database failure still rolls back the transaction", async () => {
    const statements: string[] = [];
    const runner = createTransactionRunner({
      acquireClient: async () => ({
        release: () => undefined,
        query: async (sql: string) => {
          statements.push(sql);
          if (sql.includes("SELECT"))
            throw new Error("private database credentials");
          return { rows: [], command: sql.split(" ")[0] };
        },
      }),
      createRepositories: createContentDraftRepository,
    });
    await expect(
      runner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (repository) => {
          try {
            await repository.read({
              schemaVersion: 1,
              kind: "IDOL_ALIASES",
              idolRevisionId: revisionId,
            } as never);
          } catch (error) {
            expect(String(error)).not.toContain("credentials");
          }
          return { schemaVersion: 1 };
        },
      ),
    ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});
