import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { GiftBrowse } from "./gift-browse";
import { giftBrowseFixture } from "./gift-browse-fixture";
import {
  giftBrowseHref,
  giftBrowseRecovery,
  prepareGiftBrowse,
} from "./gift-browse-query";
vi.mock("server-only", () => ({}));

test.each(SUPPORTED_LOCALES)(
  "%s publishes an unpriced, accessible gift list with category filtering and retained context",
  async (locale) => {
    const query = giftBrowseQuerySchema.parse({
      schemaVersion: 1,
      locale,
      pageSize: 1,
    });
    const response = giftBrowseResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: "a".repeat(64),
      items: [giftBrowseFixture(locale)],
      pageInfo: {
        schemaVersion: 1,
        page: 1,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
        paginationLimited: false,
      },
    });
    const copy = await loadStorefrontCopy(locale);
    const html = renderToStaticMarkup(
      <GiftBrowse
        query={query}
        initial={response}
        copy={copy}
        basePath="/"
        headingLevel={2}
        contextQuery="market=TEST&currency=USD&cart=one&cart=two&variant=old"
      />,
    );
    expect(html).toContain(
      'data-gift-link="10000000-0000-4000-8000-000000000001"',
    );
    expect(html).toContain(`<h3 lang="${locale}">Fictional gift</h3>`);
    expect(html).toContain('method="get"');
    expect(html).toContain(`action="/${locale}#gifts"`);
    expect(html).toContain(
      `href="/${locale}/gifts/fictional-gift?market=TEST&amp;currency=USD&amp;cart=one&amp;cart=two"`,
    );
    expect(html).not.toContain("giftNotAvailable");
    expect(html).not.toContain("data-market-choices");
    expect(html).not.toContain("gift-directory-card__price");
    expect(html).toContain("data-gift-next");
    expect(html).toContain("page=2");
    expect(html).toContain('name="cart" value="one"');
    expect(html).toContain('name="cart" value="two"');
  },
);

test.each([
  { page: ["1", "2"] },
  { page: "0" },
  { page: "1001" },
  { pageSize: "49" },
  { category: "invalid" },
  { idol: "invalid" },
])("rejects invalid browse query %j", (values) => {
  expect(prepareGiftBrowse("en", values)).toBeUndefined();
});

test("browse pagination and recovery preserve explicit commerce context without inferring from language", () => {
  const query = prepareGiftBrowse("th", { page: "2", category: "FOOD" });
  expect(query).toEqual({
    schemaVersion: 1,
    locale: "th",
    page: 2,
    pageSize: 12,
    category: "FOOD",
  });
  if (!query) throw new Error("Missing query");
  const href = giftBrowseHref(
    query,
    "/",
    "market=TEST&currency=JPY&cart=a&cart=b&category=FOOD",
    3,
  );
  const url = new URL(href, "https://storefront.example.test");
  expect(url.searchParams.get("market")).toBe("TEST");
  expect(url.searchParams.get("currency")).toBe("JPY");
  expect(url.searchParams.getAll("cart")).toEqual(["a", "b"]);
  expect(url.hash).toBe("#gifts");
  expect(
    giftBrowseRecovery("th", "/", {
      market: "TEST",
      currency: "JPY",
      page: "bad",
    }),
  ).toBe("/th?market=TEST&currency=JPY#gifts");
});

test("content failure is recoverable and does not show a false no-stock or region prompt", async () => {
  const copy = await loadStorefrontCopy("en");
  const query = giftBrowseQuerySchema.parse({ schemaVersion: 1, locale: "en" });
  const html = renderToStaticMarkup(
    <GiftBrowse
      query={query}
      initial={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CATALOG_UNAVAILABLE",
      }}
      copy={copy}
      basePath="/"
      headingLevel={2}
      contextQuery=""
    />,
  );
  expect(html).toContain(copy.contentError);
  expect(html).toContain("data-gift-retry");
  expect(html).not.toContain(copy.giftNotAvailable);
  expect(html).not.toContain("data-market-choices");
});
