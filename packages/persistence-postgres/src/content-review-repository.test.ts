import { describe, expect, test, vi } from "vitest";
import { createContentReviewRepository } from "./content-review-repository.js";
const revisionId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
function harness(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createContentReviewRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}
describe("content review storage boundary", () => {
  test("rejects injected actor, approval evidence, and unversioned targets", async () => {
    const { query, repository } = harness();
    expect(
      await repository.loadTarget({
        target: { kind: "IDOL_ALIASES", revisionId },
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(
      await repository.append({
        schemaVersion: 1,
        action: "APPROVE",
        target: { kind: "IDOL_ALIASES", revisionId },
        expectedVersion: 2,
        expectedContentHash: "a".repeat(64),
        expectedSourceHash: null,
        reasonCode: "CONTENT_REVIEW",
        actorId,
        requestId: actorId,
        reviewedAt: "2026-09-06T00:00:00.000Z",
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(query).not.toHaveBeenCalled();
  });
  test("does not manufacture a review target", async () => {
    expect(
      await harness().repository.loadTarget({
        schemaVersion: 1,
        target: { kind: "IDOL_ALIASES", revisionId },
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
  });
  test("prevents review of a non-draft revision", async () => {
    expect(
      await harness([[{ lifecycle: "VALIDATED" }]]).repository.loadTarget({
        schemaVersion: 1,
        target: { kind: "GIFT_DETAILS", revisionId, locale: "en" },
      }),
    ).toMatchObject({ code: "REVISION_NOT_DRAFT" });
  });
  test("a private database error cannot escape", async () => {
    const repository = createContentReviewRepository(
      {
        query: async () => {
          throw new Error("private SQL credentials");
        },
        release: () => undefined,
      },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    );
    await expect(
      repository.loadTarget({
        schemaVersion: 1,
        target: { kind: "IDOL_ALIASES", revisionId },
      }),
    ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
  });
});
