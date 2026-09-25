import { describe, expect, test, vi } from "vitest";
import { createPublishedContentRepository } from "./published-content-repository.js";
import type { TransactionScopeControl } from "./transaction-runner.js";

const scope = {
  trackOperation: <T>(work: () => Promise<T>) => work(),
} as TransactionScopeControl;
const command = {
  schemaVersion: 1 as const,
  locator: { kind: "HOMEPAGE" as const },
  locale: "en" as const,
};
function repository(rows: unknown[]) {
  const query = vi.fn(async (text: string) => ({
    rows: text.startsWith("SET ") ? [] : rows,
  }));
  return {
    query,
    repository: createPublishedContentRepository(
      { query, release: vi.fn() },
      scope,
      "https://media.example.test/",
    ),
  };
}
describe("current public content repository", () => {
  test("invalid queries fail before any PostgreSQL access", async () => {
    const value = repository([]);
    expect(
      await value.repository.load({
        ...command,
        revisionId: "caller revision",
      } as never),
    ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" });
    expect(value.query).not.toHaveBeenCalled();
  });
  test("missing current head is not found", async () => {
    expect(await repository([]).repository.load(command)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    });
  });
  test("legacy publication is not fabricated into the new manifest API", async () => {
    expect(
      await repository([{ publication: { proof_version: 1 } }]).repository.load(
        command,
      ),
    ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" });
  });
  test.each([2, undefined, null, false])(
    "missing or invalid proof version %s never falls back to legacy",
    async (version) => {
      const value = repository([
        { publication: { proof_version: version }, manifest: null },
      ]);
      expect(await value.repository.load(command)).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
    },
  );
  test("invalid public media origin is rejected before constructing a reader", () => {
    expect(() =>
      createPublishedContentRepository(
        { query: vi.fn(), release: vi.fn() },
        scope,
        "https://media.example.test/?token=private",
      ),
    ).toThrow(TypeError);
  });
});
