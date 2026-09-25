import { describe, expect, it, vi } from "vitest";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";

const scope = {
  trackOperation: <Result>(work: () => Promise<Result>) => work(),
} as TransactionScopeControl;

describe("publication preflight persistence boundary", () => {
  it("preserves serializable conflicts instead of returning a fabricated diagnostic", async () => {
    const query = vi.fn().mockRejectedValue({ code: "40001" });
    const repository = createPublicationPreflightRepository(
      { query, release: vi.fn() },
      scope,
    );
    await expect(
      repository.load({
        schemaVersion: 1,
        action: "PUBLISH",
        target: {
          owner: { kind: "HOMEPAGE" },
          revisionId: "91000000-0000-4000-8000-000000000001",
        },
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_ABORTED" });
  });
  it("reports a missing canonical revision without inventing a context", async () => {
    const query = vi.fn().mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes("max(revision)") ? [{ version: "0" }] : [],
      }),
    );
    const repository = createPublicationPreflightRepository(
      { query, release: vi.fn() },
      scope,
    );
    await expect(
      repository.load({
        schemaVersion: 1,
        action: "PUBLISH",
        target: {
          owner: { kind: "HOMEPAGE" },
          revisionId: "91000000-0000-4000-8000-000000000001",
        },
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    });
  });
  it.each([{}, { schemaVersion: 1, action: "PUBLISH", candidate: {} }])(
    "rejects malformed or caller-supplied evidence before PostgreSQL",
    async (command) => {
      const query = vi.fn();
      const repository = createPublicationPreflightRepository(
        { query, release: vi.fn() },
        scope,
      );
      await expect(repository.load(command as never)).resolves.toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
      expect(query).not.toHaveBeenCalled();
    },
  );
});
