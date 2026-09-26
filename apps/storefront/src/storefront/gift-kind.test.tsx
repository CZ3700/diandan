import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
  giftDiscoveryQuerySchema,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { GiftBrowse } from "./gift-browse";
import { giftBrowseFixture } from "./gift-browse-fixture";
import {
  giftBrowseHref,
  giftKindEntryHref,
  prepareGiftBrowse,
} from "./gift-browse-query";
import { GiftFilters } from "./gift-filters";
import { validateGiftFilterDraft } from "./gift-filter-validation";
import { giftFilterHref, giftResetHref, prepareGiftQuery } from "./gift-query";
import { HomeKinds } from "./home-kinds";
import { createSeoIdentity } from "./seo-identity";
import { fetchGiftBrowse } from "../server/public-gift-browse";
import { fetchStorefrontGiftDirectory } from "../server/public-commerce";

vi.mock("server-only", () => ({}));

const url = (href: string) => new URL(href, "https://fixture.invalid");
const escaped = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#x27;")
    .replaceAll('"', "&quot;");
const kindSelect = (html: string) =>
  /<select name="kind"[^>]*>(.*?)<\/select>/su.exec(html)?.[1] ?? "";
const page = (totalItems: number) => ({
  schemaVersion: 1 as const,
  page: 1,
  pageSize: 12,
  totalItems,
  totalPages: totalItems ? 1 : 0,
  hasPreviousPage: false,
  hasNextPage: false,
  paginationLimited: false,
});

test("the content directory keeps a gift kind in its URL state and resets it with the other filters", () => {
  expect(prepareGiftBrowse("th", { kind: "WISH", page: "2" })).toMatchObject({
    kind: "WISH",
    page: 2,
  });
  expect(prepareGiftBrowse("th", { kind: "" })).not.toHaveProperty("kind");
  expect(prepareGiftBrowse("th", { kind: "TIP" })).toBeUndefined();
  expect(
    prepareGiftBrowse("th", { kind: ["WISH", "VIRTUAL"] }),
  ).toBeUndefined();
  const query = giftBrowseQuerySchema.parse({
    schemaVersion: 1,
    locale: "th",
    kind: "WISH",
    category: "FLOWERS",
  });
  const next = url(giftBrowseHref(query, "/gifts", "market=US&cart=a", 2));
  expect(next.searchParams.get("kind")).toBe("WISH");
  expect(next.searchParams.get("page")).toBe("2");
  expect(next.searchParams.get("market")).toBe("US");
  const reset = url(giftBrowseHref(query, "/gifts", "", 1, true));
  expect(reset.searchParams.has("kind")).toBe(false);
  expect(reset.searchParams.has("category")).toBe(false);
});

test("a kind entry opens the gift directory filtered to that kind, keeping only navigation context", () => {
  const href = giftKindEntryHref(
    "vi",
    "VIRTUAL",
    "market=US&currency=USD&cart=a&cart=b&page=3&category=FOOD&kind=WISH&anchorId=x&sort=PRICE_ASC&variant=v",
  );
  const entry = url(href);
  expect(entry.pathname).toBe("/vi/gifts");
  expect([...entry.searchParams]).toEqual([
    ["market", "US"],
    ["currency", "USD"],
    ["cart", "a"],
    ["cart", "b"],
    ["kind", "VIRTUAL"],
  ]);
  expect(giftKindEntryHref("en", "WISH", "")).toBe("/en/gifts?kind=WISH");
});

test("the priced directory carries the kind to the API, keeps it across sorting and clears it on reset", () => {
  const prepared = prepareGiftQuery("en", {
    market: "US",
    currency: "USD",
    kind: "MERCHANDISE",
  });
  if (!prepared.valid) throw new Error("Expected a valid priced query");
  expect(new URLSearchParams(prepared.apiQuery).get("kind")).toBe(
    "MERCHANDISE",
  );
  expect(
    prepareGiftQuery("en", { market: "US", currency: "USD", kind: "tip" }),
  ).toMatchObject({ valid: false, reason: "INVALID_QUERY" });
  const query = prepared.query;
  const sorted = url(
    giftFilterHref(query, "/gifts", "", {
      sort: "PRICE_ASC",
      availability: "ALL",
      kind: "MERCHANDISE",
    }),
  );
  expect(sorted.searchParams.get("kind")).toBe("MERCHANDISE");
  const cleared = url(
    giftFilterHref(query, "/gifts", "", {
      sort: "RECOMMENDED",
      availability: "ALL",
    }),
  );
  expect(cleared.searchParams.has("kind")).toBe(false);
  expect(url(giftResetHref(query, "/gifts", "")).searchParams.has("kind")).toBe(
    false,
  );
  const validated = validateGiftFilterDraft(
    {
      sort: "RECOMMENDED",
      kind: "WISH",
      category: "",
      availability: "ALL",
      minimum: "",
      maximum: "",
    },
    "en",
    query,
    "/gifts",
    "",
  );
  if (validated.kind !== "VALID") throw new Error("Expected a valid draft");
  expect(url(validated.href).searchParams.get("kind")).toBe("WISH");
});

test("priced filters present the applied kind and start from it", async () => {
  const copy = await loadStorefrontCopy("es");
  const query = giftDiscoveryQuerySchema.parse({
    schemaVersion: 1,
    locale: "es",
    market: "US",
    currency: "USD",
    kind: "PHYSICAL",
  });
  const boundary = GiftFilters({
    locale: "es",
    copy,
    query,
    contextQuery: "",
    basePath: "/gifts",
  });
  expect(boundary.props.initialDraft.kind).toBe("PHYSICAL");
  expect(boundary.props.appliedFilters).toContain(
    `${copy.giftKindLabel}: ${copy.giftKindPhysical}`,
  );
  for (const option of boundary.props.sortOptions)
    expect(url(option.href).searchParams.get("kind")).toBe("PHYSICAL");
});

test.each(SUPPORTED_LOCALES)(
  "%s content directory offers the four kinds, keeps the selection and labels each classified card",
  async (locale) => {
    const copy = await loadStorefrontCopy(locale);
    const query = giftBrowseQuerySchema.parse({
      schemaVersion: 1,
      locale,
      kind: "VIRTUAL",
    });
    const html = renderToStaticMarkup(
      <GiftBrowse
        query={query}
        initial={giftBrowseResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          catalogVersion: "a".repeat(64),
          items: [{ ...giftBrowseFixture(locale), giftKind: "VIRTUAL" }],
          pageInfo: page(1),
        })}
        copy={copy}
        contextQuery="kind=VIRTUAL"
        basePath="/gifts"
        headingLevel={1}
      />,
    );
    const select = kindSelect(html);
    expect(select).toContain('value="VIRTUAL" selected=""');
    for (const kind of ["PHYSICAL", "WISH", "MERCHANDISE"])
      expect(select).toContain(`value="${kind}"`);
    expect(select).not.toContain('value="OTHER"');
    expect(select).toContain(escaped(copy.giftKindAll));
    expect(html).toContain(
      `<p class="gift-directory-card__kind">${escaped(copy.giftKindVirtual)}</p>`,
    );
    expect(html).not.toContain('type="hidden" name="kind"');
  },
);

test("unclassified and OTHER gifts carry no kind label", async () => {
  const copy = await loadStorefrontCopy("en");
  for (const giftKind of [null, "OTHER", undefined] as const) {
    const gift = giftBrowseFixture("en");
    const html = renderToStaticMarkup(
      <GiftBrowse
        query={giftBrowseQuerySchema.parse({ schemaVersion: 1, locale: "en" })}
        initial={giftBrowseResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          catalogVersion: "a".repeat(64),
          items: [giftKind === undefined ? gift : { ...gift, giftKind }],
          pageInfo: page(1),
        })}
        copy={copy}
        contextQuery=""
        basePath="/"
        headingLevel={2}
      />,
    );
    expect(html).not.toContain("gift-directory-card__kind");
  }
});

test.each(SUPPORTED_LOCALES)(
  "%s home offers four kind entries that keep navigation context",
  async (locale) => {
    const copy = await loadStorefrontCopy(locale);
    const html = renderToStaticMarkup(
      <HomeKinds
        locale={locale}
        copy={copy}
        contextQuery="market=US&currency=USD&page=2"
      />,
    );
    expect(html).toContain(
      `<h2 id="gift-kinds-title">${escaped(copy.homeKindsTitle)}</h2>`,
    );
    for (const [kind, label, body] of [
      ["VIRTUAL", copy.giftKindVirtual, copy.giftKindVirtualBody],
      ["PHYSICAL", copy.giftKindPhysical, copy.giftKindPhysicalBody],
      ["WISH", copy.giftKindWish, copy.giftKindWishBody],
      ["MERCHANDISE", copy.giftKindMerchandise, copy.giftKindMerchandiseBody],
    ] as const) {
      expect(html).toContain(
        `href="/${locale}/gifts?market=US&amp;currency=USD&amp;kind=${kind}"`,
      );
      expect(html).toContain(`data-gift-kind-entry="${kind}"`);
      expect(html).toContain(escaped(label));
      expect(html).toContain(escaped(body));
    }
    expect(html.match(/<a /gu)).toHaveLength(4);
  },
);

test("a kind-filtered directory is a noindex filter page whose canonical keeps the kind", () => {
  expect(
    createSeoIdentity("en", "gifts", undefined, {
      market: "US",
      currency: "USD",
      kind: "WISH",
    }),
  ).toEqual({
    canonicalPath: "/en/gifts?market=US&currency=USD&kind=WISH",
    noindex: true,
  });
});

test("server reads send the kind and reject a page that substitutes another kind", async () => {
  const browse = (giftKind: string | null) =>
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [{ ...giftBrowseFixture(), giftKind }],
        pageInfo: page(1),
      }),
    );
  const query = { schemaVersion: 1, locale: "en", kind: "WISH" };
  const matching = browse("WISH");
  expect(
    (await fetchGiftBrowse("https://api.example.test", query, matching))
      .outcome,
  ).toBe("SUCCESS");
  expect(
    new URL(String(matching.mock.calls[0]![0])).searchParams.get("kind"),
  ).toBe("WISH");
  for (const other of ["VIRTUAL", null])
    expect(
      await fetchGiftBrowse("https://api.example.test", query, browse(other)),
    ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  const directory = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: "a".repeat(64),
      items: [
        {
          schemaVersion: 1,
          gift: { ...giftBrowseFixture(), giftKind: "PHYSICAL" },
          offer: {
            schemaVersion: 1,
            market: "US",
            currency: "USD",
            priceMinor: 500,
            purchasable: true,
          },
        },
      ],
      pageInfo: page(1),
    }),
  );
  const params = new URLSearchParams(
    "locale=en&market=US&currency=USD&kind=WISH",
  );
  expect(
    await fetchStorefrontGiftDirectory(
      "https://api.example.test",
      params,
      directory,
    ),
  ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  expect(
    new URL(String(directory.mock.calls[0]![0])).searchParams.get("kind"),
  ).toBe("WISH");
});
