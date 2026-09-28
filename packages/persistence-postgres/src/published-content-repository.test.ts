import { describe, expect, test, vi } from "vitest";
import { publishedContentReadCommandSchema } from "@fan-support/contracts";
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
describe("deleted artists and gifts", () => {
  function ownerRepository(status: string) {
    const query = vi.fn(async (text: string) => ({
      rows: text.startsWith("SET ")
        ? []
        : text.includes("WHERE handle=$1")
          ? [{ id: "00000000-0000-4000-8000-000000000001", status }]
          : [{}, {}],
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
  const read = (kind: "IDOL" | "GIFT") =>
    publishedContentReadCommandSchema.parse({
      schemaVersion: 1,
      locator: { kind, handle: "deleted-owner" },
      locale: "en",
    });
  test.each(["IDOL", "GIFT"] as const)(
    "an archived %s reads as not found instead of temporarily unavailable",
    async (kind) => {
      const value = ownerRepository("archived");
      expect(await value.repository.load(read(kind))).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "NOT_FOUND",
      });
      expect(
        value.query.mock.calls.some(([text]) =>
          String(text).includes("content_publications"),
        ),
      ).toBe(false);
    },
  );
  test.each(["active", "paused"])(
    "a %s owner still reads its publication, so integrity failures stay unavailable",
    async (status) => {
      const value = ownerRepository(status);
      expect(await value.repository.load(read("GIFT"))).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
    },
  );
});
