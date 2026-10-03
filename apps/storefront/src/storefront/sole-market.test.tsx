import { PassThrough } from "node:stream";
import type { ReactElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  giftBrowseResponseSchema,
  giftDirectoryResponseSchema,
  giftDiscoveryQuerySchema,
  storefrontContextResponseSchema,
  type StorefrontContextResponse,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { giftBrowseFixture } from "./gift-browse-fixture";

const reads = vi.hoisted(() => ({
  context: vi.fn(),
  directory: vi.fn(),
  browse: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./storefront-page-reads", () => ({
  readCommerceContext: reads.context,
}));
vi.mock("./gift-page-reads", () => ({
  readCommerceContext: reads.context,
  giftDirectoryRead: reads.directory,
}));
vi.mock("../server/public-gift-browse", () => ({
  readGiftBrowse: reads.browse,
}));

import { giftFilterHref, giftPageHref, giftResetHref } from "./gift-query";
import { SoleMarketGiftDirectory } from "./sole-market-directory";
import { GiftDirectorySection } from "./gift-directory-section";
import { GiftBrowseBody } from "./gift-browse-section";
import { RegionChoiceEntry } from "./region-entry";
import { createSeoIdentity } from "./seo-identity";
import { soleCommerceScope } from "./commerce-scope";

const context = (markets: { market: string; currencies: string[] }[]) =>
  storefrontContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets,
    policies: [],
  });
const sole = context([{ market: "US", currencies: ["USD"] }]);
const multi = context([
  { market: "US", currencies: ["USD"] },
  { market: "JP", currencies: ["JPY"] },
]);
const unavailable: StorefrontContextResponse = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "COMMERCE_UNAVAILABLE",
};
const pageInfo = {
  schemaVersion: 1 as const,
  page: 1,
  pageSize: 12,
  totalItems: 1,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
  paginationLimited: false,
};
const priced = giftDirectoryResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [
    {
      schemaVersion: 1,
      gift: { ...giftBrowseFixture("en"), giftKind: "WISH" },
      offer: {
        schemaVersion: 1,
        market: "US",
        currency: "USD",
        priceMinor: 1200,
        purchasable: true,
      },
    },
  ],
  pageInfo,
});
const browse = giftBrowseResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [{ ...giftBrowseFixture("en"), giftKind: "WISH" }],
  pageInfo,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function streamed(element: ReactElement) {
  const response = new PassThrough();
  let html = "";
  response.on("data", (chunk: Buffer) => {
    html += chunk.toString("utf8");
  });
  const ended = new Promise<void>((resolve) => response.once("end", resolve));
  const rendering = renderToPipeableStream(element, {
    onShellReady() {
      rendering.pipe(response);
    },
  });
  await ended;
  return html;
}
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]!);

beforeEach(() => {
  reads.context.mockReset().mockResolvedValue(sole);
  reads.directory.mockReset().mockResolvedValue(priced);
  reads.browse.mockReset().mockResolvedValue(browse);
});

test("an implicit scope prices the page without writing the market into its links", () => {
  const query = giftDiscoveryQuerySchema.parse({
    schemaVersion: 1,
    locale: "en",
    market: "US",
    currency: "USD",
    kind: "WISH",
  });
  for (const href of [
    giftPageHref(query, "/gifts", "cart=a", 2, "IMPLICIT"),
    giftFilterHref(
      query,
      "/gifts",
      "cart=a",
      { sort: "PRICE_ASC", availability: "ALL", kind: "WISH" },
      "IMPLICIT",
    ),
    giftResetHref(query, "/gifts", "cart=a", "IMPLICIT"),
  ]) {
    const url = new URL(href, "https://fixture.invalid");
    expect(url.searchParams.has("market")).toBe(false);
    expect(url.searchParams.has("currency")).toBe(false);
    expect(url.searchParams.get("cart")).toBe("a");
  }
  expect(
    new URL(
      giftPageHref(query, "/gifts", "", 2),
      "https://fixture.invalid",
    ).searchParams.get("market"),
  ).toBe("US");
});

test("one published market reads the priced directory for the unscoped query and hands it to the page's renderer", async () => {
  const render = vi.fn(() => <p data-priced>priced</p>);
  const result = await SoleMarketGiftDirectory({
    locale: "en",
    values: { kind: "WISH", cart: ["a", "b"] },
    fallback: <p data-fallback>plain</p>,
    render,
  });
  expect(renderToStaticMarkup(result as ReactElement)).toContain("data-priced");
  const api = new URLSearchParams(reads.directory.mock.calls[0]![0]);
  expect(Object.fromEntries(api)).toMatchObject({
    locale: "en",
    market: "US",
    currency: "USD",
    kind: "WISH",
  });
  expect(render).toHaveBeenCalledWith({
    initial: priced,
    query: expect.objectContaining({ market: "US", currency: "USD" }),
    contextQuery: "kind=WISH&cart=a&cart=b",
  });
});

test.each(["/gifts", "/"] as const)(
  "the %s directory is priced in place and none of its links carries the implicit market",
  async (basePath) => {
    const copy = await loadStorefrontCopy("en");
    const element =
      basePath === "/"
        ? await GiftBrowseBody({
            locale: "en",
            copy,
            values: { kind: "WISH", cart: ["a", "b"] },
            basePath,
            headingLevel: 2,
            pricing: {},
          })
        : await GiftDirectorySection({
            locale: "en",
            copy,
            values: { kind: "WISH", cart: ["a", "b"] },
            context: Promise.resolve(sole),
          });
    const html = await streamed(element as ReactElement);
    expect(html).toContain("gift-directory-card__price");
    expect(html).toContain(
      basePath === "/" ? 'data-gift-priced="true"' : "data-gift-directory",
    );
    const links = hrefs(html);
    expect(links.some((href) => href.includes("cart=a"))).toBe(true);
    for (const href of links) {
      expect(href).not.toContain("market=");
      expect(href).not.toContain("currency=");
    }
  },
);

test.each([
  ["several markets", () => Promise.resolve(multi)],
  ["an unavailable context", () => Promise.resolve(unavailable)],
  ["a rejected context", () => Promise.reject(new Error("offline"))],
] as const)(
  "%s keeps the content directory without inventing a price",
  async (_, read) => {
    reads.context.mockImplementation(read);
    const fallback = <p data-fallback>plain</p>;
    const result = await SoleMarketGiftDirectory({
      locale: "en",
      values: {},
      fallback,
      render: () => <p data-priced>priced</p>,
    });
    expect(result).toBe(fallback);
    expect(reads.directory).not.toHaveBeenCalled();
  },
);

test("a priced read failure or an invalid priced query falls back to the content directory", async () => {
  const fallback = <p data-fallback>plain</p>;
  const props = {
    locale: "en" as const,
    fallback,
    render: () => <p data-priced>priced</p>,
  };
  reads.directory.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  expect(await SoleMarketGiftDirectory({ ...props, values: {} })).toBe(
    fallback,
  );
  reads.directory.mockRejectedValueOnce(new Error("offline"));
  expect(await SoleMarketGiftDirectory({ ...props, values: {} })).toBe(
    fallback,
  );
  reads.directory.mockClear();
  expect(
    await SoleMarketGiftDirectory({ ...props, values: { priceMinMinor: "x" } }),
  ).toBe(fallback);
  expect(reads.directory).not.toHaveBeenCalled();
});

test("the unscoped gift directory streams its content first and is priced in place once one market is confirmed", async () => {
  const slow = deferred<StorefrontContextResponse>();
  reads.context.mockReturnValue(slow.promise);
  const copy = await loadStorefrontCopy("en");
  const section = await GiftDirectorySection({
    locale: "en",
    copy,
    values: { kind: "WISH" },
    context: slow.promise,
  });
  const response = new PassThrough();
  let html = "";
  response.on("data", (chunk: Buffer) => {
    html += chunk.toString("utf8");
  });
  const ended = new Promise<void>((resolve) => response.once("end", resolve));
  const rendering = renderToPipeableStream(section, {
    onShellReady() {
      rendering.pipe(response);
    },
  });
  await vi.waitFor(() => expect(html).toContain("data-gift-browse"), {
    timeout: 300,
  });
  // The content card holds its price line; no price is shown before the market is known.
  expect(html).toContain("data-gift-price-pending");
  expect(html).not.toContain("fs-price");
  expect(reads.directory).not.toHaveBeenCalled();
  slow.resolve(sole);
  await ended;
  expect(html).toContain("data-gift-directory");
  expect(html).toContain("fs-price");
  expect(html).not.toContain("data-market-choices");
});

test("an explicit market choice is never replaced by the implicit scope", async () => {
  const copy = await loadStorefrontCopy("en");
  const html = renderToStaticMarkup(
    await GiftDirectorySection({
      locale: "en",
      copy,
      values: { market: "US", currency: "USD" },
      context: sole,
    }),
  );
  expect(html).toContain("data-gift-directory");
  expect(hrefs(html).some((href) => href.includes("market=US"))).toBe(true);
});

test("canonical URLs drop an implicit scope and an unscoped directory becomes the indexable priced page", () => {
  const scope = soleCommerceScope(sole)!;
  expect(createSeoIdentity("en", "gifts", undefined, {}, scope)).toEqual({
    canonicalPath: "/en/gifts",
    noindex: false,
  });
  expect(
    createSeoIdentity(
      "en",
      "gifts",
      undefined,
      { market: "US", currency: "USD", page: "2" },
      scope,
    ),
  ).toEqual({ canonicalPath: "/en/gifts?page=2", noindex: false });
  expect(
    createSeoIdentity("en", "gifts", undefined, { kind: "WISH" }, scope),
  ).toEqual({ canonicalPath: "/en/gifts?kind=WISH", noindex: true });
  const variant = "a1000000-0000-4000-8000-000000000001";
  expect(
    createSeoIdentity("th", "gift", "starlight", { variant }, scope),
  ).toEqual({
    canonicalPath: `/th/gifts/starlight?variant=${variant}`,
    noindex: false,
  });
  expect(
    createSeoIdentity(
      "th",
      "gift",
      "starlight",
      { market: "US", currency: "USD" },
      scope,
    ),
  ).toEqual({ canonicalPath: "/th/gifts/starlight", noindex: false });
  expect(
    createSeoIdentity(
      "ja",
      "artist",
      "aurora",
      { market: "US", currency: "USD" },
      scope,
    ),
  ).toEqual({ canonicalPath: "/ja/idols/aurora", noindex: false });
  expect(
    createSeoIdentity(
      "en",
      "gifts",
      undefined,
      { market: "JP", currency: "JPY" },
      scope,
    ).canonicalPath,
  ).toBe("/en/gifts?market=JP&currency=JPY");
  expect(createSeoIdentity("en", "gifts", undefined, {})).toMatchObject({
    noindex: true,
  });
});

test.each([
  [sole, false],
  [multi, true],
  [unavailable, true],
] as const)(
  "the region entry is hidden only under one market",
  async (value, shown) => {
    reads.context.mockResolvedValue(value);
    const result = await RegionChoiceEntry({
      children: <a href="/en/region">Region</a>,
    });
    expect(result === null ? "" : renderToStaticMarkup(result)).toBe(
      shown ? '<a href="/en/region">Region</a>' : "",
    );
  },
);

test("a failing context read keeps the region entry", async () => {
  reads.context.mockRejectedValue(new Error("offline"));
  const result = await RegionChoiceEntry({
    children: <a href="/en/region">Region</a>,
  });
  expect(renderToStaticMarkup(result as ReactElement)).toContain("/en/region");
});
