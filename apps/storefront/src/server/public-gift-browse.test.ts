import { expect, test, vi } from "vitest";
import { fetchGiftBrowse } from "./public-gift-browse";
import { giftBrowseFixture } from "../storefront/gift-browse-fixture";
vi.mock("server-only", () => ({}));

const query = { schemaVersion: 1, locale: "en", page: 1, pageSize: 12 };
const success = () => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [giftBrowseFixture()],
  pageInfo: {
    schemaVersion: 1,
    page: 1,
    pageSize: 12,
    totalItems: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    paginationLimited: false,
  },
});

test("a public content browse does not require or send commerce context or credentials", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(success()));
  expect(
    (await fetchGiftBrowse("https://api.example.test", query, fetcher)).outcome,
  ).toBe("SUCCESS");
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(
    "https://api.example.test/api/v1/gift-browse?locale=en&page=1&pageSize=12",
  );
  expect(init).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
});

test.each([
  () => ({ ...success(), schemaVersion: 99 }),
  () => ({ ...success(), items: [] }),
  () => ({
    ...success(),
    pageInfo: { ...success().pageInfo, page: 2, hasPreviousPage: true },
  }),
  () => ({ ...success(), items: [giftBrowseFixture("ja")] }),
  () => ({
    ...success(),
    items: [
      {
        ...giftBrowseFixture(),
        localeContext: {
          ...giftBrowseFixture().localeContext,
          fallbackUsed: true,
        },
      },
    ],
  }),
])(
  "rejects malformed or mismatched published browse responses",
  async (result) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(result()));
    expect(
      await fetchGiftBrowse("https://api.example.test", query, fetcher),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_UNAVAILABLE",
    });
  },
);

test("unsupported query never reaches the network; network/HTTP errors fail closed", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    fetchGiftBrowse(
      "https://api.example.test",
      { ...query, market: "TEST" },
      fetcher,
    ),
  ).resolves.toMatchObject({ code: "INVALID_QUERY" });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValueOnce(new Error("Synthetic failure"));
  await expect(
    fetchGiftBrowse("https://api.example.test", query, fetcher),
  ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  fetcher.mockResolvedValueOnce(Response.json(success(), { status: 503 }));
  await expect(
    fetchGiftBrowse("https://api.example.test", query, fetcher),
  ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});

test("a category mismatch and an unproven English fallback are rejected", async () => {
  const categoryMismatch = success();
  categoryMismatch.items[0]!.category = "FOOD";
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(categoryMismatch));
  await expect(
    fetchGiftBrowse(
      "https://api.example.test",
      { ...query, category: "OTHER" },
      fetcher,
    ),
  ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});

test("an unproven English fallback is rejected", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const fallback = {
    ...success(),
    items: [
      {
        ...giftBrowseFixture(),
        localeContext: {
          schemaVersion: 1,
          requestedLocale: "th",
          resolvedLocale: "en",
          fallbackUsed: true,
          translationRevision: " ",
        },
      },
    ],
  };
  fetcher.mockResolvedValueOnce(Response.json(fallback));
  await expect(
    fetchGiftBrowse(
      "https://api.example.test",
      { ...query, locale: "th" },
      fetcher,
    ),
  ).resolves.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
