import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  giftDiscoveryQuerySchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { GiftFilters } from "./gift-filters";
import { formatGiftPriceInput, giftResetHref } from "./gift-query";

vi.mock("server-only", () => ({}));

test.each(SUPPORTED_LOCALES)(
  "%s filters prepare their initial presentation on the server",
  (locale) => {
    const query = giftDiscoveryQuerySchema.parse({
      schemaVersion: 1,
      locale,
      market: "TEST",
      currency: "USD",
      priceMinMinor: 1234,
      priceMaxMinor: 4321,
      page: 3,
    });
    const contextQuery = "market=TEST&currency=USD&cart=one&cart=two&page=3";
    // RSC invokes the server wrapper without a client hook dispatcher. The
    // returned client boundary only needs serializable presentation and query.
    const boundary = GiftFilters({
      locale,
      copy,
      query,
      contextQuery,
      basePath: "/gifts",
    });
    expect(boundary.props.initialDraft).toEqual({
      sort: query.sort,
      category: "",
      availability: query.availability,
      minimum: formatGiftPriceInput(
        query.priceMinMinor,
        locale,
        query.currency,
      ),
      maximum: formatGiftPriceInput(
        query.priceMaxMinor,
        locale,
        query.currency,
      ),
    });
    expect(boundary.props.resetHref).toBe(
      giftResetHref(query, "/gifts", contextQuery),
    );
    expect(boundary.props.hint).toContain("USD");
    expect(JSON.parse(JSON.stringify(boundary.props))).toEqual(boundary.props);
  },
);

test("direct sorting preserves applied filters and repeated commerce context while returning to page one", () => {
  const query = giftDiscoveryQuerySchema.parse({
    schemaVersion: 1,
    locale: "th",
    market: "TEST",
    currency: "USD",
    category: "FLOWERS",
    availability: "PURCHASABLE",
    priceMinMinor: 1234,
    priceMaxMinor: 4321,
    page: 3,
  });
  const boundary = GiftFilters({
    locale: "th",
    copy,
    query,
    contextQuery: "market=TEST&currency=USD&cart=one&cart=two&page=3",
    basePath: "/gifts",
  });
  expect(boundary.props.sortOptions).toEqual(expect.any(Array));
  const sort = boundary.props.sortOptions.find(
    (option: { value: string }) => option.value === "PRICE_DESC",
  );
  const url = new URL(sort.href, "https://storefront.example.test");
  expect(url.pathname).toBe("/th/gifts");
  expect(url.searchParams.getAll("cart")).toEqual(["one", "two"]);
  for (const [name, value] of Object.entries({
    market: "TEST",
    currency: "USD",
    category: "FLOWERS",
    availability: "PURCHASABLE",
    priceMinMinor: "1234",
    priceMaxMinor: "4321",
    page: "1",
    sort: "PRICE_DESC",
  }))
    expect(url.searchParams.get(name)).toBe(value);
  expect(boundary.props.appliedFilters).toEqual([
    `${copy.giftCategoryLabel}: ${copy.giftCategoryFlowers}`,
    `${copy.giftAvailabilityLabel}: ${copy.giftAvailabilityPurchasable}`,
    `${copy.giftPriceMinimum}: 12.34 USD`,
    `${copy.giftPriceMaximum}: 43.21 USD`,
  ]);
});

test("the server-rendered toolbar keeps advanced fields behind a native closed disclosure and retains sorting links without JavaScript", () => {
  const query = giftDiscoveryQuerySchema.parse({
    schemaVersion: 1,
    locale: "en",
    market: "TEST",
    currency: "USD",
    category: "FLOWERS",
  });
  const html = renderToStaticMarkup(
    GiftFilters({
      locale: "en",
      copy,
      query,
      contextQuery: "cart=preserve",
      basePath: "/gifts",
    }),
  );
  expect(html).toMatch(/<details[^>]*data-gift-filter-disclosure/);
  expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
  expect(html).toContain(`>${copy.giftFilters}`);
  expect(html).toContain('data-gift-filter-count="1"');
  expect(html).toContain('data-gift-toolbar-sort="true"');
  expect(html).toMatch(
    /<form[^>]*data-gift-toolbar-form="true"[^>]*action="\/en\/gifts"[^>]*method="get"/,
  );
  expect(html).toContain('type="hidden" name="cart" value="preserve"');
  expect(html).toContain('type="hidden" name="market" value="TEST"');
  expect(html).toContain('type="hidden" name="currency" value="USD"');
  expect(html).toContain('type="hidden" name="category" value="FLOWERS"');
  expect(html).toContain('type="hidden" name="page" value="1"');
  expect(html).toContain('data-gift-filters="desktop"');
  expect(html).toContain('data-gift-price-min="true"');
  expect(html).toContain('data-gift-price-max="true"');
  expect(html).toContain("<noscript>");
  expect(html).toContain('data-gift-sort-link="PRICE_DESC"');
  expect(html).toContain("cart=preserve");
});
