import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
  giftDirectoryResponseSchema,
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

const pageOf = (totalItems: number, pageSize = 1) => ({
  schemaVersion: 1 as const,
  page: 1,
  pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / pageSize),
  hasNextPage: totalItems > pageSize,
  hasPreviousPage: false,
  paginationLimited: false,
});
/** The address of the first link carrying `marker`, as the browser would follow it. */
function linkOf(html: string, marker: string) {
  const link = new RegExp(`<a\\b[^>]*${marker}[^>]*>`, "u").exec(html)?.[0];
  const href = /href="([^"]+)"/u.exec(link ?? "")?.[1];
  if (!href) throw new Error(`Missing link ${marker}`);
  return new URL(href.replaceAll("&amp;", "&"), "https://fixture.invalid");
}

test.each(SUPPORTED_LOCALES)(
  "%s publishes an unpriced, accessible gift list whose kinds are links that keep the context",
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
      pageInfo: pageOf(2),
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
    expect(html).toContain(
      `href="/${locale}/gifts/fictional-gift?market=TEST&amp;currency=USD&amp;cart=one&amp;cart=two"`,
    );
    // L2-17: no form, no category choice and no "apply" step; nothing to submit.
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
    const virtual = linkOf(html, 'data-gift-kind-option="VIRTUAL"');
    expect(virtual.pathname).toBe(`/${locale}`);
    expect(virtual.hash).toBe("#gifts");
    expect(Object.fromEntries(virtual.searchParams)).toMatchObject({
      market: "TEST",
      currency: "USD",
      kind: "VIRTUAL",
      page: "1",
    });
    expect(virtual.searchParams.getAll("cart")).toEqual(["one", "two"]);
    expect(virtual.searchParams.has("category")).toBe(false);
    expect(html).toMatch(
      /<a\b[^>]*data-gift-kind-option="ALL"[^>]*aria-current="true"/u,
    );
    expect(html).not.toMatch(
      /<a\b[^>]*data-gift-kind-option="VIRTUAL"[^>]*aria-current/u,
    );
    // A content list has no price, so it offers no price order either.
    expect(html).not.toContain("data-gift-sort");
    expect(html).not.toContain("giftNotAvailable");
    expect(html).not.toContain("data-market-choices");
    expect(html).not.toContain("gift-directory-card__price");
    expect(html).toContain("page=2");
    expect(html).toMatch(/<a\b[^>]*data-gift-nav="page"[^>]*data-gift-next/u);
  },
);

test("every card carries its summary, and holds its price line only while prices are being read", async () => {
  const copy = await loadStorefrontCopy("en");
  const query = giftBrowseQuerySchema.parse({ schemaVersion: 1, locale: "en" });
  const gift = giftBrowseFixture("en");
  const props = {
    query,
    copy,
    basePath: "/",
    headingLevel: 2 as const,
    contextQuery: "",
  };
  const content = giftBrowseResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: "a".repeat(64),
    items: [gift],
    pageInfo: pageOf(1),
  });
  const summary = `<p class="gift-directory-card__summary" lang="en">${gift.shortDescription}</p>`;
  const settled = renderToStaticMarkup(
    <GiftBrowse {...props} initial={content} />,
  );
  expect(settled).toContain(summary);
  expect(settled).not.toContain("gift-directory-card__price");
  const pending = renderToStaticMarkup(
    <GiftBrowse {...props} initial={content} pricePending />,
  );
  expect(pending).toContain(summary);
  expect(pending).toContain('data-gift-price-pending="true"');
  expect(pending).not.toContain("fs-price");
  const priced = renderToStaticMarkup(
    <GiftBrowse
      {...props}
      sort="PRICE_ASC"
      initial={giftDirectoryResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [
          {
            schemaVersion: 1,
            gift,
            offer: {
              schemaVersion: 1,
              market: "TEST",
              currency: "USD",
              priceMinor: 950,
              purchasable: true,
            },
          },
        ],
        pageInfo: pageOf(1),
      })}
    />,
  );
  expect(priced).toContain(summary);
  expect(priced).toContain("$9.50");
  expect(priced).not.toContain("data-gift-price-pending");
  expect(priced).toContain('data-gift-priced="true"');
});

test("a priced home list orders by price with two links; the active one returns to the recommended order", async () => {
  const copy = await loadStorefrontCopy("zh-CN");
  const query = giftBrowseQuerySchema.parse({
    schemaVersion: 1,
    locale: "zh-CN",
    kind: "VIRTUAL",
    page: 3,
  });
  const html = renderToStaticMarkup(
    <GiftBrowse
      query={query}
      copy={copy}
      basePath="/"
      headingLevel={2}
      contextQuery="kind=VIRTUAL&page=3&sort=PRICE_ASC&cart=a"
      sort="PRICE_ASC"
      initial={giftDirectoryResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [],
        pageInfo: { ...pageOf(0, 12), page: 3, hasPreviousPage: true },
      })}
    />,
  );
  expect(html).toContain(`aria-label="${copy.giftSortLabel}"`);
  expect(html).toContain(`>${copy.giftSortPrice}</span>`);
  const ascending = linkOf(html, 'data-gift-sort-option="PRICE_ASC"');
  const descending = linkOf(html, 'data-gift-sort-option="PRICE_DESC"');
  // Active: a second click clears the order. Both return to the first page.
  expect(ascending.searchParams.has("sort")).toBe(false);
  expect(descending.searchParams.get("sort")).toBe("PRICE_DESC");
  for (const url of [ascending, descending]) {
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("kind")).toBe("VIRTUAL");
    expect(url.searchParams.get("cart")).toBe("a");
    expect(url.hash).toBe("#gifts");
  }
  expect(html).toMatch(
    /<a\b[^>]*data-gift-nav="sort:RECOMMENDED"[^>]*data-gift-sort-option="PRICE_ASC"[^>]*aria-current="true"/u,
  );
  expect(html).toMatch(
    new RegExp(
      `<a\\b[^>]*data-gift-nav="sort:PRICE_DESC"[^>]*aria-label="${copy.giftSortPriceDesc}"`,
      "u",
    ),
  );
  expect(html).not.toMatch(
    /<a\b[^>]*data-gift-sort-option="PRICE_DESC"[^>]*aria-current/u,
  );
  // Choosing another kind keeps the order and drops the page.
  const physical = linkOf(html, 'data-gift-kind-option="PHYSICAL"');
  expect(Object.fromEntries(physical.searchParams)).toMatchObject({
    kind: "PHYSICAL",
    sort: "PRICE_ASC",
    page: "1",
  });
  expect(
    linkOf(html, 'data-gift-kind-option="ALL"').searchParams.has("kind"),
  ).toBe(false);
});

test("a category carried by an address is named and can be cleared, although the toolbar no longer offers it", async () => {
  const copy = await loadStorefrontCopy("en");
  const query = giftBrowseQuerySchema.parse({
    schemaVersion: 1,
    locale: "en",
    category: "FLOWERS",
    kind: "PHYSICAL",
  });
  const html = renderToStaticMarkup(
    <GiftBrowse
      query={query}
      copy={copy}
      basePath="/gifts"
      headingLevel={1}
      contextQuery="category=FLOWERS&kind=PHYSICAL"
      initial={giftBrowseResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [],
        pageInfo: pageOf(0, 12),
      })}
    />,
  );
  expect(html).toContain("data-gift-applied-filters");
  expect(html).toContain(
    `${copy.giftCategoryLabel}: ${copy.giftCategoryFlowers}`,
  );
  const clear = linkOf(html, 'data-gift-reset="true"');
  expect(clear.searchParams.has("category")).toBe(false);
  expect(clear.searchParams.get("kind")).toBe("PHYSICAL");
});

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
