import {
  Children,
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  giftDirectoryResponseSchema,
  storefrontContextResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { directoryFixturePage } from "./directory-fixture";
import { CartProvider } from "./cart-provider";
import { GiftDirectorySection } from "./gift-directory-section";
import { GiftPageSeo } from "./gift-seo";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({ deploymentEnvironment: "test" }),
  loadStorefrontPresentationConfig: () => ({ name: "Test studio" }),
}));
const reads = vi.hoisted(() => ({
  copy: vi.fn(),
  context: vi.fn(),
  artists: vi.fn(),
  directory: vi.fn(),
  restore: vi.fn(),
  seo: vi.fn(),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: reads.copy,
}));
vi.mock("../server/cart-restoration-hint", () => ({
  readCartRestorationHint: reads.restore,
}));
vi.mock("./gift-page-reads", () => ({
  readCommerceContext: reads.context,
  artistRead: reads.artists,
  giftDirectoryRead: reads.directory,
  giftRead: vi.fn(),
  commerceRead: vi.fn(),
  policyRead: vi.fn(),
}));
vi.mock("./gift-seo", () => ({
  GiftPageSeo: () => null,
  loadGiftSeo: reads.seo,
}));

import * as en from "../app/(public)/(latin)/en/gifts/page";
import * as zh from "../app/(public)/(simplified-chinese)/zh-CN/gifts/page";
import * as th from "../app/(public)/(thai)/th/gifts/page";
import * as viRoute from "../app/(public)/(vietnamese)/vi/gifts/page";
import * as ja from "../app/(public)/(japanese)/ja/gifts/page";
import * as es from "../app/(public)/(latin)/es/gifts/page";
import * as pt from "../app/(public)/(latin)/pt/gifts/page";

// Route modules are test fixtures; contracts remain the locale inventory.
const routes = new Map<SupportedLocale, typeof en>([
  ["en", en],
  ["zh-CN", zh],
  ["th", th],
  ["vi", viRoute],
  ["ja", ja],
  ["es", es],
  ["pt", pt],
]);
function routeFor(locale: SupportedLocale) {
  const route = routes.get(locale);
  if (!route) throw new Error(`Missing route fixture for ${locale}`);
  return route;
}
const context = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [{ market: "GLOBAL", currencies: ["USD"] }],
  policies: [{ policyKey: "studio-delivery", kind: "DELIVERY" }],
});
const directory = giftDirectoryResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: {
    schemaVersion: 1,
    page: 2,
    pageSize: 12,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: true,
    hasNextPage: false,
    paginationLimited: false,
  },
});
const artists = directoryFixturePage([1, 2]);
if (artists.outcome !== "SUCCESS" || !artists.items[1])
  throw new Error("Missing fixture artist");
const selectedArtist = artists.items[1];
const query = {
  market: "GLOBAL",
  currency: "USD",
  idol: selectedArtist.id.toUpperCase(),
  sort: "PRICE_DESC",
  category: "OTHER",
  availability: "PURCHASABLE",
  priceMinMinor: "1000",
  priceMaxMinor: "2500",
  page: "2",
  cart: ["one", "two"],
};

function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const elements: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<Record<string, unknown>>(child))
      elements.push(
        child,
        ...descendants(child.props["children"] as ReactNode),
      );
  });
  return elements;
}
async function page(locale: SupportedLocale, values = query) {
  const entry = await routeFor(locale).default({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(values),
  });
  expect(entry.type).toBe(Suspense);
  expect(entry.props.fallback).toBeTruthy();
  const child = entry.props.children as ReactElement;
  const renderPage = child.type as (props: unknown) => Promise<ReactElement>;
  return renderPage(child.props);
}
async function directoryMarkup(tree: ReactElement) {
  const section = descendants(tree).find(
    (element) => element.type === GiftDirectorySection,
  );
  if (!section) throw new Error("Missing server directory section");
  return renderToStaticMarkup(
    await GiftDirectorySection(
      section.props as Parameters<typeof GiftDirectorySection>[0],
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  for (const read of Object.values(reads)) read.mockReset();
  reads.copy.mockImplementation((locale: SupportedLocale) =>
    loadStorefrontCopy(locale, { requireApproved: false }),
  );
  reads.context.mockResolvedValue(context);
  reads.artists.mockResolvedValue(artists);
  reads.directory.mockResolvedValue(directory);
  reads.restore.mockResolvedValue(false);
});

test.each(SUPPORTED_LOCALES)(
  "%s directory route preserves localized SSR, selected artist and complete filter context",
  async (locale) => {
    const tree = await page(locale);
    const html = await directoryMarkup(tree);
    const copy = await loadStorefrontCopy(locale, { requireApproved: false });
    expect(routeFor(locale).dynamic).toBe("force-dynamic");
    expect(html).toContain(`<h1>${copy.giftTitle}</h1>`);
    expect(html).toContain(`data-directory-recipient="${selectedArtist.id}"`);
    expect(html).toContain(selectedArtist.displayName);
    expect(html).not.toContain("Fictional 1");
    expect(html).toContain('data-gift-filters="desktop"');
    expect(html).toContain('value="PRICE_DESC" selected=""');
    expect(html).toContain('value="OTHER" selected=""');
    expect(html).toContain('value="PURCHASABLE" selected=""');
    expect(html).toContain('data-gift-page-out-of-range="true"');
    expect(html).toContain(`href="/${locale}/idols/${selectedArtist.handle}?`);
    expect(html).toContain("cart=one&amp;cart=two");
    expect(reads.artists).toHaveBeenCalledWith(locale, query.idol);
    const apiQuery = new URLSearchParams(
      reads.directory.mock.calls[0]![0] as string,
    );
    expect(Object.fromEntries(apiQuery)).toMatchObject({
      locale,
      market: query.market,
      currency: query.currency,
      idol: query.idol,
      sort: query.sort,
      category: query.category,
      availability: query.availability,
      priceMinMinor: query.priceMinMinor,
      priceMaxMinor: query.priceMaxMinor,
      page: query.page,
    });
    expect(apiQuery.has("cart")).toBe(false);
    const nodes = descendants(tree);
    const seo = nodes.find((element) => element.type === GiftPageSeo);
    expect(seo?.props).toMatchObject({ locale, kind: "gifts", values: query });
    const provider = nodes.find((element) => element.type === CartProvider);
    expect(provider?.props).toMatchObject({ locale, restoreOnLoad: false });
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s directory metadata retains the same locale, kind and search parameters",
  async (locale) => {
    const metadata = { title: `Fixture ${locale}` };
    reads.seo.mockResolvedValue({ metadata });
    await expect(
      routeFor(locale).generateMetadata({
        params: Promise.resolve({}),
        searchParams: Promise.resolve(query),
      }),
    ).resolves.toBe(metadata);
    expect(reads.seo).toHaveBeenCalledWith(locale, "gifts", undefined, query);
  },
);

test.each(["context", "copy", "restore"] as const)(
  "the directory waits for %s before selecting an artist and rendering",
  async (blocked) => {
    const value = {
      context,
      copy: await loadStorefrontCopy("en", { requireApproved: false }),
      restore: true,
    }[blocked];
    const slow = deferred<typeof value>();
    reads[blocked].mockReturnValue(slow.promise);
    const pending = page("en");
    try {
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(reads.context).toHaveBeenCalledOnce();
      expect(reads.copy).toHaveBeenCalledOnce();
      expect(reads.restore).toHaveBeenCalledOnce();
      expect(reads.artists).not.toHaveBeenCalled();
    } finally {
      slow.resolve(value);
    }
    const tree = await pending;
    expect(reads.artists).toHaveBeenCalledWith("en", query.idol);
    const provider = descendants(tree).find(
      (element) => element.type === CartProvider,
    );
    expect(provider?.props["restoreOnLoad"]).toBe(blocked === "restore");
  },
);

test("a directory context rejection is consumed while copy is still pending", async () => {
  const copy = await loadStorefrontCopy("en", { requireApproved: false });
  const slowCopy = deferred<typeof copy>();
  reads.copy.mockReturnValue(slowCopy.promise);
  const failure = new Error("Synthetic directory context failure");
  reads.context.mockRejectedValue(failure);
  let rejected: unknown;
  const pending = page("en").catch((error: unknown) => {
    rejected = error;
  });
  try {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(rejected).toBe(failure);
    expect(reads.artists).not.toHaveBeenCalled();
  } finally {
    slowCopy.resolve(copy);
    await pending;
  }
});

test("the directory does not display a different artist when the selected artist is absent", async () => {
  reads.artists.mockResolvedValue(directoryFixturePage([1]));
  expect(await directoryMarkup(await page("en"))).not.toContain(
    "data-directory-recipient",
  );
});
