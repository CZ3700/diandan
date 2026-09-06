import { describe, expect, it, vi } from "vitest";
import { createBaseContentPreviewRepository } from "./base-content-preview-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";

const scope = {
  trackOperation: <Result>(work: () => Promise<Result>) => work(),
} as TransactionScopeControl;

describe("base content preview persistence boundary", () => {
  it.each(["issue", "read", "revoke"] as const)(
    "rejects malformed %s before PostgreSQL",
    async (method) => {
      const query = vi.fn();
      const repository = createBaseContentPreviewRepository(
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
});
