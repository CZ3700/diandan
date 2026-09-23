import { expect, test, vi } from "vitest";
import { createIdolDirectoryCursor } from "@fan-support/catalog";
import type {
  CatalogDirectoryRepository,
  ContentReadTransactionManager,
} from "@fan-support/persistence-port";

import { createCatalogDirectoryUseCases } from "./catalog-directory.js";
import { createFictionalIdolDirectoryRecord } from "./test-support/catalog-directory-fixture.js";

const catalogVersion = "a".repeat(64);
const idolQuery = { schemaVersion: 1, locale: "en" };
const giftQuery = {
  schemaVersion: 1,
  locale: "th",
  market: "TEST",
  currency: "USD",
};

function harness(overrides: Partial<CatalogDirectoryRepository> = {}) {
  const readIdols = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    catalogVersion,
    items: [],
    hasNextPage: false,
  }));
  const readGifts = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    catalogVersion,
    items: [],
    totalItems: 0,
  }));
  const repository: CatalogDirectoryRepository = {
    readIdols,
    readGifts,
    browseGifts: readGifts,
    ...overrides,
  };
  const run = vi.fn();
  const transactions: ContentReadTransactionManager = {
    async runInContentReadTransaction(work) {
      run();
      return work({ catalogDirectory: repository });
    },
  };
  return {
    ...createCatalogDirectoryUseCases({
      transactions,
    }),
    run,
    readIdolsRepository: readIdols,
    readGiftsRepository: readGifts,
  };
}

test("validates public inputs before acquiring a database snapshot", async () => {
  const subject = harness();
  for (const query of [
    null,
    {},
    { ...idolQuery, limit: 41 },
    { ...idolQuery, q: "  name" },
  ]) {
    await expect(subject.readIdols(query)).resolves.toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_QUERY",
    });
  }
  await expect(
    subject.readGifts({ ...giftQuery, currency: undefined }),
  ).resolves.toMatchObject({ code: "INVALID_QUERY" });
  expect(subject.run).not.toHaveBeenCalled();
});

test("returns an empty artist window through the transactional repository", async () => {
  const subject = harness();
  await expect(subject.readIdols(idolQuery)).resolves.toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion,
    items: [],
    pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
  });
  expect(subject.readIdolsRepository).toHaveBeenCalledWith(
    expect.objectContaining({
      schemaVersion: 1,
      plan: expect.objectContaining({
        take: 13,
        query: { ...idolQuery, limit: 12 },
      }),
    }),
  );
});

test("preserves an out-of-range gift page and explicit transaction context", async () => {
  const subject = harness();
  await expect(
    subject.readGifts({ ...giftQuery, page: 9, sort: "PRICE_DESC" }),
  ).resolves.toMatchObject({
    outcome: "SUCCESS",
    pageInfo: {
      page: 9,
      pageSize: 12,
      totalItems: 0,
      totalPages: 0,
      hasPreviousPage: true,
      hasNextPage: false,
    },
  });
  expect(subject.readGiftsRepository).toHaveBeenCalledWith(
    expect.objectContaining({
      plan: expect.objectContaining({
        offset: 96,
        query: expect.objectContaining(giftQuery),
      }),
    }),
  );
});

test("rejects malformed cursors before querying persistence", async () => {
  const subject = harness();
  await expect(
    subject.readIdols({ ...idolQuery, after: "not_a_cursor" }),
  ).resolves.toMatchObject({ code: "INVALID_CURSOR" });
  expect(subject.run).not.toHaveBeenCalled();
});

test("forwards a query-bound cursor and rejects its reuse in another locale", async () => {
  const afterId = "60000000-0000-4000-8000-000000000001";
  const cursor = createIdolDirectoryCursor({
    schemaVersion: 1,
    query: idolQuery,
    catalogVersion,
    afterId,
  });
  const subject = harness();
  await expect(
    subject.readIdols({ ...idolQuery, after: cursor }),
  ).resolves.toMatchObject({ outcome: "SUCCESS" });
  expect(subject.readIdolsRepository).toHaveBeenCalledWith(
    expect.objectContaining({
      continuation: expect.objectContaining({ catalogVersion, afterId }),
    }),
  );
  subject.run.mockClear();
  await expect(
    subject.readIdols({ ...idolQuery, locale: "ja", after: cursor }),
  ).resolves.toMatchObject({ code: "INVALID_CURSOR" });
  expect(subject.run).not.toHaveBeenCalled();
});

test("passes a database version change through as a recoverable navigation result", async () => {
  const subject = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_CHANGED",
    }),
  });
  await expect(subject.readIdols(idolQuery)).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_CHANGED",
  });
});

test("fails closed on corrupt repository output and exceptions without leaking internals", async () => {
  const broken = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [],
      hasNextPage: true,
    }),
  });
  await expect(broken.readIdols(idolQuery)).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  const failed = harness({
    readGifts: async () => {
      throw new Error("private database connection details");
    },
  });
  await expect(failed.readGifts(giftQuery)).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  const invalid = harness({
    readGifts: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [],
      totalItems: 1,
    }),
  });
  await expect(invalid.readGifts(giftQuery)).resolves.toMatchObject({
    code: "CATALOG_UNAVAILABLE",
  });
});

test("projects verified publication content and never exposes internal evidence", async () => {
  const record = createFictionalIdolDirectoryRecord();
  const subject = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [record],
      hasNextPage: true,
    }),
  });
  const result = await subject.readIdols({ ...idolQuery, limit: 1 });
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    items: [{ displayName: "Fictional Luma" }],
    pageInfo: { hasNextPage: true, endCursor: expect.any(String) },
  });
  for (const privateField of [
    "currentPublication",
    "selectedTranslation",
    "rightsReference",
    "editorId",
    "objectKey",
  ]) {
    expect(JSON.stringify(result)).not.toContain(privateField);
  }
});

test("rejects corrupted approved content, drafts, wrong locale and case-insensitive duplicate IDs", async () => {
  const record = createFictionalIdolDirectoryRecord();
  if (record.selection.objectKind !== "IDOL")
    throw new Error("Expected fictional idol selection");
  const draft = {
    ...record,
    selection: {
      ...record.selection,
      operationalStatus: "draft" as const,
      acceptingGifts: false,
    },
    source: {
      ...record.source,
      base: {
        ...record.source.base,
        status: "draft" as const,
        acceptingGifts: false,
      },
    },
  };
  const unpublished = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [draft],
      hasNextPage: false,
    }),
  });
  await expect(unpublished.readIdols(idolQuery)).resolves.toMatchObject({
    code: "CATALOG_UNAVAILABLE",
  });
  const upperCaseRecord = JSON.parse(
    JSON.stringify(record).replaceAll(
      record.source.base.id,
      record.source.base.id.toUpperCase(),
    ),
  ) as typeof record;
  const duplicate = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [record, upperCaseRecord],
      hasNextPage: false,
    }),
  });
  await expect(duplicate.readIdols(idolQuery)).resolves.toMatchObject({
    code: "CATALOG_UNAVAILABLE",
  });
  const tampered = {
    ...record,
    source: {
      ...record.source,
      translation: {
        ...record.source.translation,
        displayName: "Unapproved replacement",
      },
    },
  };
  const corrupt = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [tampered],
      hasNextPage: false,
    }),
  });
  await expect(corrupt.readIdols(idolQuery)).resolves.toMatchObject({
    code: "CATALOG_UNAVAILABLE",
  });
  const valid = harness({
    readIdols: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion,
      items: [record],
      hasNextPage: false,
    }),
  });
  await expect(
    valid.readIdols({ ...idolQuery, locale: "ja" }),
  ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
