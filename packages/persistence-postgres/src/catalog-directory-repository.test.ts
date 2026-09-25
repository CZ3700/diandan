import { describe, expect, test, vi } from "vitest";
import {
  createGiftDiscoveryPlan,
  createIdolDiscoveryPlan,
  createIdolDirectoryCursor,
  decodeIdolDirectoryCursor,
} from "@fan-support/catalog";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
import { createCatalogDirectoryRepository } from "./catalog-directory-repository.js";

vi.mock("./catalog-publication-loader.js", () => ({
  loadIdolDirectoryRecords: vi.fn(async () => []),
  loadGiftDirectoryRecords: vi.fn(async () => []),
}));

const version = "a".repeat(64);
function harness(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  const client: TransactionClient = { query, release: () => undefined };
  const transactionScope: TransactionScopeControl = {
    markRollbackOnly: vi.fn(),
    trackOperation: async (operation) => operation(),
  };
  return {
    query,
    repository: createCatalogDirectoryRepository(client, {
      transactionScope,
      publicMediaBaseUrl: "https://media.example.invalid",
    }),
  };
}

describe("catalog directory repository", () => {
  test("cursor query binding and decoded continuation must agree before SQL", async () => {
    const queryInput = { schemaVersion: 1, locale: "en" };
    const after = createIdolDirectoryCursor({
      schemaVersion: 1,
      query: queryInput,
      catalogVersion: version,
      afterId: "10000000-0000-4000-8000-000000000001",
    });
    const continuation = decodeIdolDirectoryCursor({
      schemaVersion: 1,
      query: queryInput,
      cursor: after,
    });
    if (continuation === undefined)
      throw new Error("valid test cursor did not decode");
    for (const command of [
      {
        schemaVersion: 1 as const,
        plan: createIdolDiscoveryPlan({ ...queryInput, after }),
      },
      {
        schemaVersion: 1 as const,
        plan: createIdolDiscoveryPlan(queryInput),
        continuation,
      },
      {
        schemaVersion: 1 as const,
        plan: createIdolDiscoveryPlan({ ...queryInput, locale: "th", after }),
        continuation,
      },
      {
        schemaVersion: 1 as const,
        plan: createIdolDiscoveryPlan({ ...queryInput, after }),
        continuation: {
          ...continuation,
          afterId:
            "10000000-0000-4000-8000-000000000002" as typeof continuation.afterId,
        },
      },
    ]) {
      const { repository, query } = harness([]);
      expect(await repository.readIdols(command)).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_CURSOR",
      });
      expect(query).not.toHaveBeenCalled();
    }
  });

  test("a cursor with an earlier server catalog version requires restart", async () => {
    const queryInput = { schemaVersion: 1, locale: "en" };
    const after = createIdolDirectoryCursor({
      schemaVersion: 1,
      query: queryInput,
      catalogVersion: "b".repeat(64),
      afterId: "10000000-0000-4000-8000-000000000001",
    });
    const continuation = decodeIdolDirectoryCursor({
      schemaVersion: 1,
      query: queryInput,
      cursor: after,
    });
    if (continuation === undefined)
      throw new Error("valid test cursor did not decode");
    const { repository } = harness([
      {
        catalog_version: version,
        projection_complete: true,
        anchor_found: true,
        cursor_found: true,
        ids: [],
      },
    ]);
    expect(
      await repository.readIdols({
        schemaVersion: 1,
        plan: createIdolDiscoveryPlan({ ...queryInput, after }),
        continuation,
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_CHANGED",
    });
  });

  test("returns a real empty artist window with metadata", async () => {
    const { repository } = harness([
      {
        catalog_version: version,
        projection_complete: true,
        anchor_found: true,
        cursor_found: true,
        ids: [],
      },
    ]);
    expect(
      await repository.readIdols({
        schemaVersion: 1,
        plan: createIdolDiscoveryPlan({ schemaVersion: 1, locale: "en" }),
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: version,
      items: [],
      hasNextPage: false,
    });
  });

  test("rejects a tampered server query plan without touching PostgreSQL", async () => {
    const { repository, query } = harness([]);
    const plan = createGiftDiscoveryPlan({
      schemaVersion: 1,
      locale: "en",
      market: "TEST",
      currency: "USD",
    });
    expect(
      await repository.readGifts({
        schemaVersion: 1,
        plan: { ...plan, offset: 12 },
      }),
    ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" });
    expect(query).not.toHaveBeenCalled();
  });

  test("missing or stale search projections fail closed even for browsing", async () => {
    const { repository } = harness([
      {
        catalog_version: version,
        projection_complete: false,
        anchor_found: true,
        cursor_found: true,
        ids: [],
      },
    ]);
    expect(
      await repository.readIdols({
        schemaVersion: 1,
        plan: createIdolDiscoveryPlan({ schemaVersion: 1, locale: "th" }),
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_UNAVAILABLE",
    });
  });

  test("unknown anchors are explicit and page overflow remains an empty requested page", async () => {
    const artist = harness([
      {
        catalog_version: version,
        projection_complete: true,
        anchor_found: false,
        cursor_found: true,
        ids: [],
      },
    ]);
    expect(
      await artist.repository.readIdols({
        schemaVersion: 1,
        plan: createIdolDiscoveryPlan({
          schemaVersion: 1,
          locale: "en",
          anchorId: "10000000-0000-4000-8000-000000000001",
        }),
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "ANCHOR_NOT_FOUND",
    });
    const gifts = harness([
      { catalog_version: version, total_items: "120", items: [] },
    ]);
    expect(
      await gifts.repository.readGifts({
        schemaVersion: 1,
        plan: createGiftDiscoveryPlan({
          schemaVersion: 1,
          locale: "pt",
          market: "TEST",
          currency: "USD",
          page: 1000,
        }),
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: version,
      items: [],
      totalItems: 120,
    });
  });
});
