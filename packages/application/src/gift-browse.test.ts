import { expect, test, vi } from "vitest";
import type {
  CatalogDirectoryRepository,
  ContentReadTransactionManager,
} from "@fan-support/persistence-port";
import { createGiftBrowseUseCase } from "./gift-browse.js";
import { createFictionalGiftBrowseRecord } from "./test-support/gift-browse-fixture.js";
import { selectPublishedGift } from "@fan-support/content";

const snapshot = {
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  catalogVersion: "a".repeat(64),
  totalItems: 0,
  items: [],
};
function harness(result: unknown = snapshot) {
  const browseGifts = vi.fn<CatalogDirectoryRepository["browseGifts"]>(
    async () => result as typeof snapshot,
  );
  const transactions: ContentReadTransactionManager = {
    runInContentReadTransaction: vi.fn(async (work) =>
      work({
        catalogDirectory: {
          browseGifts,
          readGifts: async () => {
            throw new Error("Commerce reads are not browsing");
          },
          readIdols: async () => {
            throw new Error("Unexpected artist read");
          },
        },
      }),
    ),
  };
  return {
    execute: createGiftBrowseUseCase({ transactions }),
    browseGifts,
    transactions,
  };
}

test("validates content-only discovery before entering a database snapshot", async () => {
  const subject = harness();
  for (const input of [
    null,
    {},
    { schemaVersion: 1, locale: "en", market: "TEST" },
    { schemaVersion: 1, locale: "en", pageSize: 49 },
  ])
    await expect(subject.execute(input)).resolves.toMatchObject({
      code: "INVALID_QUERY",
    });
  expect(
    subject.transactions.runInContentReadTransaction,
  ).not.toHaveBeenCalled();
});

test("passes a bounded context-free query and preserves an out-of-range requested page", async () => {
  const subject = harness({ ...snapshot, totalItems: 13 });
  await expect(
    subject.execute({ schemaVersion: 1, locale: "th", page: 9 }),
  ).resolves.toMatchObject({
    outcome: "SUCCESS",
    items: [],
    pageInfo: {
      page: 9,
      totalItems: 13,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    },
  });
  expect(subject.browseGifts).toHaveBeenCalledWith({
    schemaVersion: 1,
    query: { schemaVersion: 1, locale: "th", page: 9, pageSize: 12 },
  });
});

test("fails closed on incomplete pages, malformed publication records and infrastructure exceptions", async () => {
  for (const result of [
    { ...snapshot, totalItems: 1 },
    {
      ...snapshot,
      totalItems: 1,
      items: [{ schemaVersion: 1, source: "draft" }],
    },
    { ...snapshot, offer: {} },
  ])
    await expect(
      harness(result).execute({ schemaVersion: 1, locale: "en" }),
    ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  const subject = harness();
  subject.browseGifts.mockRejectedValueOnce(
    new Error("private database detail"),
  );
  await expect(
    subject.execute({ schemaVersion: 1, locale: "en" }),
  ).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});

test("returns recoverable repository failures without manufacturing content or prices", async () => {
  const failure = {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  };
  await expect(
    harness(failure).execute({ schemaVersion: 1, locale: "en" }),
  ).resolves.toEqual(failure);
});

test("projects real publication proof without exposing evidence, prices or source-only fields", async () => {
  const record = createFictionalGiftBrowseRecord();
  const proof = selectPublishedGift(record.selection, record.source);
  expect(proof, JSON.stringify(proof)).toMatchObject({ success: true });
  const result = await harness({
    ...snapshot,
    totalItems: 1,
    items: [record],
  }).execute({ schemaVersion: 1, locale: "en" });
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    items: [{ title: "Fictional gift", handle: "fictional-gift" }],
  });
  for (const privateField of [
    "currentPublication",
    "selectedTranslation",
    "rightsReference",
    "editorId",
    "objectKey",
    "market",
    "currency",
    "priceMinor",
    "offer",
  ])
    expect(JSON.stringify(result)).not.toContain(privateField);
});

test("accepts proven English fallback while rejecting wrong locale, mutated text, category mismatch and duplicate identities", async () => {
  const record = createFictionalGiftBrowseRecord();
  record.source.localeContext = {
    ...record.source.localeContext,
    requestedLocale: "th",
    fallbackUsed: true,
  };
  await expect(
    harness({ ...snapshot, totalItems: 1, items: [record] }).execute({
      schemaVersion: 1,
      locale: "th",
    }),
  ).resolves.toMatchObject({
    outcome: "SUCCESS",
    items: [
      {
        localeContext: {
          requestedLocale: "th",
          resolvedLocale: "en",
          fallbackUsed: true,
        },
      },
    ],
  });
  for (const [records, query] of [
    [[record], { locale: "ja" }],
    [
      [
        {
          ...record,
          source: {
            ...record.source,
            translation: {
              ...record.source.translation,
              title: "Unapproved text",
            },
          },
        },
      ],
      { locale: "th" },
    ],
    [[record], { locale: "th", category: "FLOWERS" }],
    [[record, record], { locale: "th" }],
  ] as const)
    await expect(
      harness({
        ...snapshot,
        totalItems: records.length,
        items: records,
      }).execute({ schemaVersion: 1, ...query }),
    ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
