import { beforeEach, expect, test, vi } from "vitest";
import { giftBrowseReadCommandSchema } from "@fan-support/contracts";
import { createCatalogDirectoryRepository } from "./catalog-directory-repository.js";
import { loadGiftDirectoryRecords } from "./catalog-publication-loader.js";
import type { TransactionClient } from "./transaction-runner.js";

vi.mock("./catalog-publication-loader.js", () => ({
  loadGiftDirectoryRecords: vi.fn(async () => []),
  loadIdolDirectoryRecords: vi.fn(async () => []),
}));

const version = "a".repeat(64);
const gift = "10000000-0000-4000-8000-000000000001";
const command = (query = {}) =>
  giftBrowseReadCommandSchema.parse({
    schemaVersion: 1,
    query: { schemaVersion: 1, locale: "en", ...query },
  });
function harness(
  rows: unknown[] = [{ catalog_version: version, total_items: "0", ids: [] }],
) {
  const query = vi.fn<TransactionClient["query"]>(async () => ({ rows }));
  const repository = createCatalogDirectoryRepository(
    { query, release: () => undefined },
    {
      publicMediaBaseUrl: "https://media.example.invalid",
      transactionScope: {
        markRollbackOnly: vi.fn(),
        trackOperation: async (work) => work(),
      },
    },
  );
  return { repository, query };
}
beforeEach(() =>
  vi.mocked(loadGiftDirectoryRecords).mockReset().mockResolvedValue([]),
);

test("browse rejects unknown commerce inputs before SQL", async () => {
  const { repository, query } = harness();
  for (const extra of [
    { market: "GLOBAL" },
    { page: 0 },
    { pageSize: 49 },
    { locale: "invalid" },
  ]) {
    expect(
      await repository.browseGifts({
        ...command(),
        query: { ...command().query, ...extra },
      } as never),
    ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" });
  }
  expect(query).not.toHaveBeenCalled();
});
test("empty and out-of-range pages retain their real total without hydration", async () => {
  const empty = harness();
  expect(await empty.repository.browseGifts(command())).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: version,
    totalItems: 0,
    items: [],
    giftKinds: [],
  });
  const later = harness([
    { catalog_version: version, total_items: "13", ids: [] },
  ]);
  expect(
    await later.repository.browseGifts(command({ page: 3 })),
  ).toMatchObject({ outcome: "SUCCESS", totalItems: 13, items: [] });
  expect(loadGiftDirectoryRecords).not.toHaveBeenCalled();
  expect(later.query.mock.calls[0]?.[1]).toEqual([
    "en",
    null,
    null,
    12,
    24,
    null,
  ]);
  const filtered = harness([
    { catalog_version: version, total_items: "0", ids: [] },
  ]);
  await filtered.repository.browseGifts(command({ kind: "WISH" }));
  expect(filtered.query.mock.calls[0]?.[1]).toEqual([
    "en",
    null,
    null,
    12,
    0,
    "WISH",
  ]);
});
test.each(
  [
    [{ catalog_version: version, total_items: "1", ids: [] }],
    [
      {
        catalog_version: version,
        total_items: "2",
        ids: [
          [gift, null],
          [gift, null],
        ],
      },
    ],
    [{ catalog_version: version, total_items: "1", ids: [gift] }],
    [{ catalog_version: version, total_items: "1", ids: [[gift, "TIP"]] }],
    [{ catalog_version: version, total_items: "1", ids: [[gift]] }],
    [{ catalog_version: version, total_items: "9007199254740992", ids: [] }],
    [{ catalog_version: version, total_items: "01", ids: [] }],
    [{ catalog_version: "invalid", total_items: "0", ids: [] }],
    [],
  ].map((rows) => ({ rows })),
)(
  "browse rejects inconsistent metadata instead of silently hiding records",
  async ({ rows }) => {
    await expect(
      harness(rows).repository.browseGifts(command()),
    ).rejects.toThrow();
  },
);
test("only the selected window is hydrated, with complete publication proof required", async () => {
  const { repository } = harness([
    { catalog_version: version, total_items: "1", ids: [[gift, "VIRTUAL"]] },
  ]);
  await expect(repository.browseGifts(command())).rejects.toThrow();
  expect(loadGiftDirectoryRecords).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    [gift],
    "en",
    "https://media.example.invalid",
    expect.anything(),
    { verifiedLocaleFallback: true },
  );
});
