import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  giftDirectoryResponseSchema,
  giftDiscoveryQuerySchema,
  publishedGiftViewSchema,
} from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";

const query = giftDiscoveryQuerySchema.parse({
  schemaVersion: 1,
  locale: "en",
  market: "TEST",
  currency: "USD",
  page: 2,
});
const gift = publishedGiftViewSchema.parse({
  schemaVersion: 1,
  id: "10000000-0000-4000-8000-000000000001",
  handle: "fictional-gift",
  status: "active",
  localeContext: {
    schemaVersion: 1,
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
  },
  title: "Fictional gift",
  subtitle: "Prepared for an artist",
  shortDescription: "A fictional gift",
  description: "A fictional gift description",
  fulfillmentDescription: "The studio prepares and delivers it to the artist.",
  category: "OTHER",
  contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
  deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
  shippingMode: "internal_to_idol",
  primaryMedia: {
    schemaVersion: 1,
    kind: "INFORMATIVE",
    url: "https://media.example.test/processed/v1/source/variant.webp",
    alt: "Fictional gift photograph",
    width: 1000,
    height: 1000,
    focalPoint: { x: 0.5, y: 0.5 },
  },
  gallery: [],
  variants: [
    {
      schemaVersion: 1,
      id: "20000000-0000-4000-8000-000000000001",
      label: "Gift",
      status: "active",
      inventoryPolicy: "PROCURE_ON_DEMAND",
    },
  ],
  safetyNotice: "Fictional test gift",
  seoTitle: "Fictional gift",
  seoDescription: "A fictional gift for directory tests",
});

function page(
  totalItems: number,
  pageNumber: number,
  price: number | null,
  include = true,
) {
  const totalPages = Math.ceil(totalItems / 12);
  return giftDirectoryResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: "a".repeat(64),
    items: include
      ? [
          {
            schemaVersion: 1,
            gift,
            offer: {
              schemaVersion: 1,
              market: "TEST",
              currency: "USD",
              priceMinor: price,
              purchasable: price !== null,
            },
          },
        ]
      : [],
    pageInfo: {
      schemaVersion: 1,
      page: pageNumber,
      pageSize: 12,
      totalItems,
      totalPages,
      hasPreviousPage: pageNumber > 1,
      hasNextPage: pageNumber < totalPages && pageNumber < 1000,
      paginationLimited: totalPages > 1000,
    },
  });
}
const component = () => import("./gift-directory");

test("the card's server link clears stale variant selection from a different gift", async () => {
  const { GiftDirectory } = await component();
  const context =
    "market=TEST&currency=USD&idol=30000000-0000-4000-8000-000000000001&cart=one&cart=two&variant=20000000-0000-4000-8000-000000000099&page=2";
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={query}
      initial={page(25, 2, 1234)}
      contextQuery={context}
    />,
  );
  const card = html.match(/<a\b[^>]*href="([^"]+)"[^>]*data-gift-link=/u)?.[1];
  expect(card).toBe(
    "/en/gifts/fictional-gift?market=TEST&amp;currency=USD&amp;idol=30000000-0000-4000-8000-000000000001&amp;cart=one&amp;cart=two&amp;page=2",
  );
});

test("renders bounded server pagination and real gift links carrying the complete navigation context", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={query}
      initial={page(25, 2, 1234)}
      contextQuery="market=TEST&currency=USD&cart=one&cart=two&page=2"
      headingLevel={1}
    />,
  );
  expect(html).toContain("25 gifts");
  expect(html).toContain("Page 2 of 3");
  expect(html).toMatch(/<a[^>]+data-gift-next/);
  expect(html).toContain('data-gift-page="3"');
  expect(html).not.toContain('data-gift-page="4"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain(
    "/en/gifts/fictional-gift?market=TEST&amp;currency=USD&amp;cart=one&amp;cart=two&amp;page=2",
  );
  expect(html).toContain("<h2");
  expect(html).toContain('value="1234"');
  expect(html).toContain("$12.34");
  expect(html).toContain('loading="lazy"');
  // L2-17: a priced card shows the same summary as the content card.
  expect(html).toContain(
    '<p class="gift-directory-card__summary" lang="en">A fictional gift</p>',
  );
});

test("the toolbar offers kinds and a price order as links, with no form, panel or apply step", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={{ ...query, sort: "PRICE_DESC" }}
      initial={page(25, 2, 1234)}
      contextQuery="market=TEST&currency=USD&cart=one&page=2&sort=PRICE_DESC"
    />,
  );
  for (const gone of ["<form", "<select", "<details", "<button", "<input"])
    expect(html).not.toContain(gone);
  expect(html).not.toContain("data-gift-applied-filters");
  const link = (marker: string) => {
    const anchor = new RegExp(`<a\\b[^>]*${marker}[^>]*>`, "u").exec(html)?.[0];
    const href = /href="([^"]+)"/u.exec(anchor ?? "")?.[1];
    if (!anchor || !href) throw new Error(`Missing link ${marker}`);
    return {
      anchor,
      url: new URL(href.replaceAll("&amp;", "&"), "https://fixture.invalid"),
    };
  };
  const descending = link('data-gift-sort-option="PRICE_DESC"');
  expect(descending.anchor).toContain('aria-current="true"');
  expect(descending.anchor).toContain('data-gift-nav="sort:RECOMMENDED"');
  expect(descending.url.searchParams.get("sort")).toBe("RECOMMENDED");
  const ascending = link('data-gift-sort-option="PRICE_ASC"');
  expect(ascending.anchor).not.toContain("aria-current");
  expect(ascending.url.searchParams.get("sort")).toBe("PRICE_ASC");
  const virtual = link('data-gift-kind-option="VIRTUAL"');
  for (const { url } of [descending, ascending, virtual]) {
    expect(url.pathname).toBe("/en/gifts");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("market")).toBe("TEST");
    expect(url.searchParams.get("cart")).toBe("one");
  }
  expect(virtual.url.searchParams.get("kind")).toBe("VIRTUAL");
  expect(virtual.url.searchParams.get("sort")).toBe("PRICE_DESC");
  expect(html).toContain('<p class="gift-directory-count" aria-live="polite">');
});

test("filters the toolbar no longer offers are still honoured, named and clearable when an address carries them", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={giftDiscoveryQuerySchema.parse({
        ...query,
        kind: "PHYSICAL",
        sort: "PRICE_ASC",
        category: "FLOWERS",
        availability: "PURCHASABLE",
        priceMinMinor: 1234,
        priceMaxMinor: 4321,
      })}
      initial={page(25, 2, 1234)}
    />,
  );
  const summary =
    /<div class="gift-filter-summary"[^>]*>(.*?)<\/div>/su.exec(html)?.[1] ??
    "";
  expect(summary).toContain(
    `${copy.giftCategoryLabel}: ${copy.giftCategoryFlowers}`,
  );
  expect(summary).toContain(
    `${copy.giftAvailabilityLabel}: ${copy.giftAvailabilityPurchasable}`,
  );
  expect(summary).toContain(copy.giftPriceMinimum);
  expect(summary).toContain("$12.34");
  expect(summary).toContain("$43.21");
  const clear = new URL(
    (/href="([^"]+)"[^>]*data-gift-reset/u.exec(summary)?.[1] ?? "").replaceAll(
      "&amp;",
      "&",
    ),
    "https://fixture.invalid",
  );
  // Clearing them keeps what the toolbar shows: the kind and the price order.
  expect(Object.fromEntries(clear.searchParams)).toMatchObject({
    kind: "PHYSICAL",
    sort: "PRICE_ASC",
    availability: "ALL",
    page: "1",
  });
  for (const name of ["category", "priceMinMinor", "priceMaxMinor"])
    expect(clear.searchParams.has(name)).toBe(false);
});

test("an unpriced record has an honest unavailable label and no fabricated price or cart action", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={query}
      initial={page(25, 2, null)}
    />,
  );
  expect(html).toContain(copy.giftNotAvailable);
  expect(html).not.toContain('class="fs-price"');
  expect(html).not.toContain("$0.00");
  expect(html).not.toContain("Sold out");
  expect(html).not.toContain("Add to cart");
});

test("out-of-range pages remain empty and expose recovery without substituting another page", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={{ ...query, page: 5 }}
      initial={page(25, 5, null, false)}
    />,
  );
  expect(html).toContain("data-gift-page-out-of-range");
  expect(html).toContain(copy.giftPageOutOfRangeTitle);
  expect(html).toContain("Page 5 of 3");
  expect(html).not.toContain("Fictional gift");
  expect(html).toContain("page=1");
});

test("the navigation ceiling retains the real total and never links to page 1001", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={{ ...query, page: 1000 }}
      initial={page(12012, 1000, 1234)}
    />,
  );
  expect(html).toContain("Page 1,000 of 1,001");
  expect(html).toContain("Only the first 1,000 pages can be browsed");
  expect(html).not.toContain("page=1001");
  expect(html).not.toMatch(/<a[^>]+data-gift-next/);
  expect([...html.matchAll(/data-gift-page=/gu)].length).toBeLessThanOrEqual(7);
});

test("catalog failures expose a safe same-context retry instead of stale offers", async () => {
  const { GiftDirectory } = await component();
  const html = renderToStaticMarkup(
    <GiftDirectory
      locale="en"
      copy={copy}
      query={query}
      initial={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CATALOG_UNAVAILABLE",
      }}
      basePath="/idols/fictional-artist"
      contextQuery="market=TEST&currency=USD&cart=preserve"
    />,
  );
  expect(html).toContain('data-outcome="failure"');
  expect(html).toContain("data-gift-retry");
  expect(html).toContain("/en/idols/fictional-artist?");
  expect(html).toContain("cart=preserve");
  expect(html).not.toContain("CATALOG_UNAVAILABLE");
  expect(html).not.toContain("Fictional gift");
});
