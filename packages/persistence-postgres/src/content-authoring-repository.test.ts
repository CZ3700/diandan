import { describe, expect, it, vi } from "vitest";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";

const scope = {
  trackOperation: <Result>(work: () => Promise<Result>) => work(),
} as TransactionScopeControl;

describe("content authoring persistence boundary", () => {
  it("rejects malformed reads before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = createContentAuthoringRepository(
      { query, release: vi.fn() },
      scope,
    );
    await expect(repository.read({} as never)).resolves.toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied publication state before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = createContentAuthoringRepository(
      { query, release: vi.fn() },
      scope,
    );
    await expect(
      repository.write({ lifecycle: "PUBLISHED" } as never),
    ).resolves.toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
