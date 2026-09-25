import { describe, expect, it, vi } from "vitest";
import { createContentPreviewRepository } from "./content-preview-repository.js";

const target = {
  kind: "IDOL_ALIASES" as const,
  revisionId: "10000000-0000-4000-8000-000000000001",
  locale: "en" as const,
};
function harness(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  const repository = createContentPreviewRepository(
    { query, release: () => undefined },
    { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
  );
  return { query, repository };
}
describe("content preview grants", () => {
  it("rejects invalid commands before database access", async () => {
    const { repository, query } = harness();
    expect(
      await repository.read({
        schemaVersion: 1,
        target,
        token: "private-token",
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(query).not.toHaveBeenCalled();
  });
  it("returns one opaque unavailable result for unknown or expired grants", async () => {
    expect(
      await harness().repository.read({
        schemaVersion: 1,
        target,
        tokenDigest: "a".repeat(64),
      } as never),
    ).toMatchObject({ code: "PREVIEW_UNAVAILABLE" });
  });
  it("does not leak database failure payload", async () => {
    const { query, repository } = harness();
    query.mockRejectedValueOnce(new Error("sensitive-query-payload"));
    await expect(
      repository.read({
        schemaVersion: 1,
        target,
        tokenDigest: "a".repeat(64),
      } as never),
    ).rejects.not.toThrow("sensitive-query-payload");
  });
});
