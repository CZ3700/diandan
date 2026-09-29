import { PassThrough } from "node:stream";
import { isValidElement, type ReactElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  createDefaultHomeLayout,
  storefrontContextResponseSchema,
  storefrontHomepageResponseSchema,
  giftDirectoryResponseSchema,
  type StorefrontHomepageResponse,
  type IdolDirectoryResponse,
  type StorefrontContextResponse,
  type GiftDirectoryResponse,
  type PublishedContentResponse,
} from "@fan-support/contracts";
import { directoryFixturePage } from "./directory-fixture";
import { HomeContent } from "./home-content";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";

const reads = vi.hoisted(() => ({
  catalog: vi.fn(),
  context: vi.fn(),
  seo: vi.fn(),
  gifts: vi.fn(),
  browse: vi.fn(),
  layout: vi.fn(),
}));
vi.mock("../server/public-home-layout", () => ({
  readPublicHomeLayout: reads.layout,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: () => false }),
}));
vi.mock("./browse-seo", () => ({
  BrowsePageSeo: reads.seo,
  loadBrowseSeo: vi.fn(),
}));
vi.mock("../server/public-catalog", () => ({
  readPublicCatalog: reads.catalog,
}));
vi.mock("../server/public-commerce", () => ({
  readStorefrontContext: reads.context,
  readPublishedGiftCommerce: vi.fn(),
  readStorefrontGift: vi.fn(),
  readStorefrontGiftDirectory: reads.gifts,
}));
vi.mock("../server/public-gift-browse", () => ({
  readGiftBrowse: reads.browse,
}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({ deploymentEnvironment: "test" }),
  loadStorefrontPresentationConfig: () => ({ name: "Fixture Studio" }),
}));

const unavailable: StorefrontHomepageResponse = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
};
const contextUnavailable: StorefrontContextResponse = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "COMMERCE_UNAVAILABLE",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function publishedHome(locale: (typeof SUPPORTED_LOCALES)[number]) {
  const page = directoryFixturePage([1]);
  if (page.outcome !== "SUCCESS" || !page.items[0])
    throw new Error("Missing test artist");
  const artist = page.items[0];
  artist.localeContext = {
    schemaVersion: 1,
    requestedLocale: locale,
    resolvedLocale: locale,
    fallbackUsed: false,
  };
  const publication = {
    id: "b0000000-0000-4000-8000-000000000001",
    revisionId: "c0000000-0000-4000-8000-000000000001",
    manifestHash: "a".repeat(64),
    publishedAt: "2026-09-07T00:00:00Z",
  };
  return storefrontHomepageResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_HOMEPAGE",
    homepage: {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PUBLISHED_CONTENT",
      publication,
      content: {
        kind: "HOMEPAGE",
        view: {
          schemaVersion: 1,
          localeContext: artist.localeContext,
          heroTitle: "Verified hero before directory",
          heroSubtitle: "Published introduction",
          ctaLabel: "Explore",
          heroDesktop: artist.heroDesktop,
          heroMobile: {
            ...artist.heroMobile,
            url: "https://media.invalid/mobile.webp",
            width: 1080,
            height: 1350,
          },
          slots: [
            {
              schemaVersion: 1,
              kind: "HERO_IDOL",
              slotKey: "hero",
              idolId: artist.id,
              label: "Featured artist",
              sortOrder: 0,
            },
          ],
          seoTitle: "Published homepage",
          seoDescription: "Published homepage description",
        },
      },
    },
    slots: [
      {
        kind: "HERO_IDOL",
        slotKey: "hero",
        idolId: artist.id,
        status: "AVAILABLE",
        content: {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "PUBLISHED_CONTENT",
          publication,
          content: { kind: "IDOL", view: artist, aliases: [] },
        },
      },
    ],
  });
}

test("homepage offers one artist browsing path and retains featured links when the directory is absent", async () => {
  const home = publishedHome("en");
  if (home.outcome !== "SUCCESS") throw new Error("Missing test homepage");
  const hero = home.slots[0];
  if (hero?.status !== "AVAILABLE" || hero.kind !== "HERO_IDOL")
    throw new Error("Missing test artist");
  home.slots.push({ ...hero, kind: "FEATURED_IDOL", slotKey: "featured" });
  const copy = await loadStorefrontCopy("en");
  const href = `/en/idols/${hero.content.content.view.handle}?market=TEST_MARKET&currency=USD`;
  const render = (directory?: ReactElement) =>
    renderToStaticMarkup(
      <HomeContent
        data={home}
        locale="en"
        copy={copy}
        contextQuery="market=TEST_MARKET&currency=USD"
        directory={directory}
      />,
    )
      .split('id="artists"')[1]
      ?.split('id="gifts"')[0] ?? "";
  const browsable = render(
    <nav aria-label="Artist directory">
      <a href={href}>{hero.content.content.view.displayName}</a>
    </nav>,
  );
  const fallback = render();
  const encodedHref = href.replaceAll("&", "&amp;");
  expect(browsable.split(`href="${encodedHref}"`)).toHaveLength(2);
  expect(fallback).toContain(`href="${encodedHref}"`);
});

// User requests 2026-09-29: L2-11 merged the artist guides; L2-13 gives the hero back its
// gold button to all artists and puts the search right under the artist section title.
test("homepage hero has one gold button to all artists and the search sits under the artist title", async () => {
  const copy = await loadStorefrontCopy("en");
  const html = renderToStaticMarkup(
    <HomeContent
      data={publishedHome("en")}
      locale="en"
      copy={copy}
      contextQuery="currency=USD"
      directory={<nav aria-label="Artist directory" />}
    />,
  );
  const hero =
    html.split('data-home-hero="true"')[1]?.split("</section>")[0] ?? "";
  expect(hero.split("storefront-primary")).toHaveLength(2);
  expect(hero).toContain('href="/en/idols?currency=USD"');
  expect(hero).toContain(copy.heroAllArtists);
  // The published content label (fixture "Explore") no longer shows in the hero.
  expect(hero).not.toContain("Explore");
  expect(hero).not.toContain("data-artist-search");
  expect(hero).not.toContain("storefront-text-link");
  expect(hero).not.toContain("storefront-hero-caption");
  const artists = html.split('id="artists"')[1]?.split("</section>")[0] ?? "";
  const [heading, below = ""] = artists.split("</h2>");
  expect(heading).toContain(copy.artistTitle);
  expect(below.split("data-artist-search")).toHaveLength(2);
  expect(below.indexOf("data-artist-search")).toBeLessThan(
    below.indexOf('aria-label="Artist directory"'),
  );
  expect(below).toContain(`placeholder="${copy.artistSearchLabel}"`);
  expect(artists).not.toContain(copy.artistEyebrow);
  expect(artists).not.toContain(copy.backArtists);
});

function publishedArtist(locale: (typeof SUPPORTED_LOCALES)[number]) {
  const home = publishedHome(locale);
  if (home.outcome !== "SUCCESS") throw new Error("Missing test homepage");
  const slot = home.slots[0];
  if (slot?.status !== "AVAILABLE" || slot.content.content.kind !== "IDOL")
    throw new Error("Missing test artist publication");
  return { ...slot.content, content: slot.content.content };
}

test("homepage renders configured section order and visibility without losing required entry anchors", async () => {
  const ids = [
    "HERO",
    "GIFTS",
    "ARTISTS",
    "KINDS",
    "POLICIES",
    "HOW_IT_WORKS",
    "STUDIO_PROMISE",
    "FINAL_CTA",
  ] as const;
  const html = renderToStaticMarkup(
    <HomeContent
      locale="en"
      copy={await loadStorefrontCopy("en")}
      contextQuery="currency=USD"
      data={publishedHome("en")}
      layout={{
        schemaVersion: 1,
        sections: ids.map((id) => ({ id, visible: id !== "HOW_IT_WORKS" })),
      }}
      giftDirectory={<section id="gifts">Published gifts</section>}
    />,
  );
  expect(html.indexOf('id="gifts"')).toBeLessThan(html.indexOf('id="artists"'));
  expect(html).not.toContain('id="how-title"');
  expect(html).toContain('id="hero-title"');
  expect(html).toContain(
    'data-home-hero-link="artists" href="/en/idols?currency=USD"',
  );
});

function giftPage(locale: (typeof SUPPORTED_LOCALES)[number]) {
  const artist = publishedArtist(locale).content.view;
  return giftDirectoryResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: "a".repeat(64),
    items: [
      {
        schemaVersion: 1,
        gift: {
          schemaVersion: 1,
          id: "d0000000-0000-4000-8000-000000000001",
          handle: "streamed-gift",
          status: "active",
          localeContext: artist.localeContext,
          title: "Gift from the server directory",
          subtitle: "Prepared for the artist",
          shortDescription: "A test gift",
          description: "A test gift description",
          fulfillmentDescription: "The studio delivers it to the artist.",
          category: "OTHER",
          contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
          deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
          shippingMode: "internal_to_idol",
          primaryMedia: artist.portrait,
          gallery: [],
          variants: [
            {
              schemaVersion: 1,
              id: "e0000000-0000-4000-8000-000000000001",
              label: "Gift",
              status: "active",
              inventoryPolicy: "PROCURE_ON_DEMAND",
            },
          ],
          safetyNotice: "Test gift",
          seoTitle: "Test gift",
          seoDescription: "A test gift for server rendering",
        },
        offer: {
          schemaVersion: 1,
          market: "TEST_MARKET",
          currency: "USD",
          priceMinor: 500,
          purchasable: true,
        },
      },
    ],
    pageInfo: {
      schemaVersion: 1,
      page: 1,
      pageSize: 12,
      totalItems: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      paginationLimited: false,
    },
  });
}

async function streamHome(
  locale: (typeof SUPPORTED_LOCALES)[number],
  values: Record<string, string | string[]> = {},
) {
  const { createStorefrontPage } = await import("./page-factory");
  const Entry = createStorefrontPage(locale, "home");
  return stream(
    <Entry
      searchParams={Promise.resolve(values)}
      params={Promise.resolve({})}
    />,
  );
}

function stream(element: ReactElement) {
  const response = new PassThrough();
  let html = "";
  const errors: unknown[] = [];
  response.on("data", (chunk: Buffer) => {
    html += chunk.toString("utf8");
  });
  const ended = new Promise<void>((resolve, reject) => {
    response.once("end", resolve);
    response.once("error", reject);
  });
  const rendering = renderToPipeableStream(element, {
    onShellReady() {
      rendering.pipe(response);
    },
    onError(error) {
      errors.push(error);
    },
  });
  return { html: () => html, ended, errors, abort: () => rendering.abort() };
}

beforeEach(() => {
  reads.layout.mockReset().mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HOME_LAYOUT",
    source: "DEFAULT",
    layout: createDefaultHomeLayout(),
    version: 0,
    publicationId: null,
  });
  reads.catalog
    .mockReset()
    .mockImplementation(async (_path, _query, kind) =>
      kind === "directory" ? directoryFixturePage([]) : unavailable,
    );
  reads.context.mockReset().mockResolvedValue(contextUnavailable);
  reads.seo.mockReset().mockReturnValue(null);
  reads.gifts.mockReset();
  reads.browse.mockReset().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});
// Measure the scheduling of reads after module loading, independently of transform/worker startup.
beforeAll(async () => {
  await import("./page-factory");
});

async function startHome(
  locale: (typeof SUPPORTED_LOCALES)[number] = "en",
  values: Record<string, string | string[]> = {},
) {
  const { createStorefrontPage } = await import("./page-factory");
  const Entry = createStorefrontPage(locale, "home");
  const entry = Entry({
    searchParams: Promise.resolve(values),
    params: Promise.resolve({}),
  });
  if (!isValidElement<{ children: ReactElement }>(entry))
    throw new Error("Home entry must keep its loading boundary");
  const page = entry.props.children;
  if (typeof page.type !== "function") throw new Error("Missing server page");
  return Reflect.apply(page.type, undefined, [
    page.props,
  ]) as Promise<ReactElement>;
}

test("starts homepage and initial artist window reads independently", async () => {
  const home = deferred<StorefrontHomepageResponse>();
  const directory = deferred<IdolDirectoryResponse>();
  reads.catalog.mockImplementation((_path, _query, kind) =>
    kind === "homepage" ? home.promise : directory.promise,
  );
  const pending = startHome();
  try {
    await vi.waitFor(
      () => {
        expect(reads.catalog.mock.calls.map((call) => call[2])).toEqual([
          "homepage",
          "directory",
        ]);
      },
      { timeout: 300 },
    );
  } finally {
    home.resolve(unavailable);
    directory.resolve(directoryFixturePage([]));
    await pending;
  }
});

test.each(SUPPORTED_LOCALES)(
  "%s streams the verified hero before a slow directory and retains its final server cards and anchor",
  async (locale) => {
    const home = deferred<StorefrontHomepageResponse>();
    const directory = deferred<IdolDirectoryResponse>();
    const initial = directoryFixturePage([2]);
    if (initial.outcome !== "SUCCESS" || !initial.items[0])
      throw new Error("Missing test directory");
    const artist = initial.items[0];
    artist.localeContext = {
      schemaVersion: 1,
      requestedLocale: locale,
      resolvedLocale: locale,
      fallbackUsed: false,
    };
    reads.catalog.mockImplementation((_path, _query, kind) =>
      kind === "homepage" ? home.promise : directory.promise,
    );
    const streamed = await streamHome(locale, {
      anchorId: artist.id,
      market: "TEST_MARKET",
      currency: "JPY",
    });
    try {
      await vi.waitFor(() => expect(reads.catalog).toHaveBeenCalledTimes(2));
      expect(streamed.html()).not.toContain('id="hero-title"');
      home.resolve(publishedHome(locale));
      await vi.waitFor(
        () => expect(streamed.html()).toContain('id="hero-title"'),
        { timeout: 300 },
      );
      expect(streamed.html()).toContain('id="artists"');
      expect(streamed.html()).toContain('rel="preload" as="image"');
      expect(streamed.html()).toContain("media.invalid%2Fmobile.webp");
      expect(streamed.html()).toContain('fetchPriority="high"');
      expect(streamed.html()).not.toContain("Fictional 2");
      const directoryRead = reads.catalog.mock.calls.find(
        (call) => call[2] === "directory",
      );
      expect(directoryRead?.[1].get("locale")).toBe(locale);
      expect(directoryRead?.[1].get("anchorId")).toBe(artist.id);
    } finally {
      home.resolve(unavailable);
      directory.resolve(initial);
      await streamed.ended;
      streamed.abort();
    }
    expect(streamed.errors).toEqual([]);
    expect(streamed.html()).toContain("Fictional 2");
    expect(streamed.html()).toContain('data-artist-start="true"');
    expect(streamed.html()).toContain(
      `/${locale}/idols/fictional-2?market=TEST_MARKET&amp;currency=JPY`,
    );
  },
);

test.each(["CATALOG_UNAVAILABLE", "ANCHOR_NOT_FOUND"] as const)(
  "a delayed %s directory renders its error after the verified hero",
  async (code) => {
    const directory = deferred<IdolDirectoryResponse>();
    reads.catalog.mockImplementation((_path, _query, kind) =>
      kind === "homepage"
        ? Promise.resolve(publishedHome("en"))
        : directory.promise,
    );
    const streamed = await streamHome("en");
    try {
      await vi.waitFor(
        () => expect(streamed.html()).toContain('id="hero-title"'),
        { timeout: 300 },
      );
      expect(streamed.html()).not.toContain(`data-error="${code}"`);
    } finally {
      directory.resolve({ schemaVersion: 1, outcome: "FAILURE", code });
      await streamed.ended;
      streamed.abort();
    }
    expect(streamed.errors).toEqual([]);
    expect(streamed.html()).toContain(`data-error="${code}"`);
    expect(streamed.html()).toContain('data-artist-retry="true"');
  },
);

test("a slow SEO component does not hold the verified hero or initial directory", async () => {
  const seo = deferred<ReactElement | null>();
  reads.seo.mockReturnValue(seo.promise);
  reads.catalog.mockImplementation(async (_path, _query, kind) =>
    kind === "homepage" ? publishedHome("en") : directoryFixturePage([2]),
  );
  const streamed = await streamHome("en");
  try {
    await vi.waitFor(
      () => expect(streamed.html()).toContain('id="hero-title"'),
      { timeout: 300 },
    );
    expect(streamed.html()).toContain("Fictional 2");
    expect(streamed.html()).not.toContain("Resolved SEO boundary");
  } finally {
    seo.resolve(
      <script type="application/ld+json">
        {'{"name":"Resolved SEO boundary"}'}
      </script>,
    );
    await streamed.ended;
    streamed.abort();
  }
  expect(streamed.errors).toEqual([]);
  expect(streamed.html()).toContain("Resolved SEO boundary");
});

test("public page content does not wait for footer commerce context", async () => {
  const footer = deferred<StorefrontContextResponse>();
  reads.context.mockReturnValue(footer.promise);
  let resolved = false;
  const pending = startHome().then((page) => {
    resolved = true;
    return page;
  });
  try {
    await vi.waitFor(() => expect(resolved).toBe(true), { timeout: 300 });
  } finally {
    footer.resolve(contextUnavailable);
    await pending;
  }
});

test("streams the shell before footer policy data and then includes its real published links", async () => {
  const footer = deferred<StorefrontContextResponse>();
  reads.context.mockReturnValue(footer.promise);
  const page = await startHome("en", {
    currency: "JPY",
    market: "TEST_MARKET",
  });
  const response = new PassThrough();
  let html = "";
  let shellReady = false;
  const errors: unknown[] = [];
  response.on("data", (chunk: Buffer) => {
    html += chunk.toString("utf8");
  });
  const ended = new Promise<void>((resolve, reject) => {
    response.once("end", resolve);
    response.once("error", reject);
  });
  const rendering = renderToPipeableStream(page, {
    onShellReady() {
      shellReady = true;
      rendering.pipe(response);
    },
    onError(error) {
      errors.push(error);
    },
  });
  try {
    await vi.waitFor(() => expect(shellReady).toBe(true), { timeout: 300 });
    expect(reads.context).toHaveBeenCalled();
    expect(html).toContain('id="main-content"');
    expect(html).toContain("Fixture Studio");
    expect(html).not.toContain("/policies/test-studio-terms");
  } finally {
    footer.resolve(
      storefrontContextResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_CONTEXT",
        markets: [],
        policies: [{ policyKey: "test-studio-terms", kind: "TERMS" }],
      }),
    );
    await ended;
    rendering.abort();
  }
  expect(errors).toEqual([]);
  expect(html).toContain(
    "/en/policies/test-studio-terms?market=TEST_MARKET&amp;currency=JPY",
  );
});

test.each(SUPPORTED_LOCALES)(
  "%s keeps current locale and exact query context in the shell",
  async (locale) => {
    const page = await startHome(locale, {
      market: "TEST_MARKET",
      currency: "JPY",
      tracking: ["first", "second"],
    });
    const rendered = stream(page);
    await rendered.ended;
    const html = rendered.html();
    rendered.abort();
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(
      `/${locale}/idols?market=TEST_MARKET&amp;currency=JPY&amp;tracking=first&amp;tracking=second`,
    );
    expect(html).toContain("Fixture Studio");
    expect(html).toContain('id="main-content"');
  },
);

test("invalid anchor still rejects the directory read rather than silently showing the first page", async () => {
  await startHome("en", { anchorId: "not-an-id" });
  expect(reads.catalog.mock.calls.map((call) => call[2])).toEqual(["homepage"]);
});

test.each(["not a handle", "missing-artist"])(
  "artist %s is rejected before returning a streaming shell",
  async (handle) => {
    reads.catalog.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    });
    const { createArtistStorefrontPage } =
      await import("./artist-page-factory");
    const Entry = createArtistStorefrontPage("en");
    const result = Entry({
      searchParams: Promise.resolve({}),
      params: Promise.resolve({ handle }),
    });
    expect(isValidElement(result)).toBe(false);
    await expect(result).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(reads.context).not.toHaveBeenCalled();
    expect(reads.catalog).toHaveBeenCalledTimes(
      handle === "missing-artist" ? 1 : 0,
    );
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s streams an existing artist before commerce context and preserves the eventual server gift directory",
  async (locale) => {
    const proof = deferred<PublishedContentResponse>();
    const context = deferred<StorefrontContextResponse>();
    const gifts = deferred<GiftDirectoryResponse>();
    const artist = publishedArtist(locale);
    reads.catalog.mockReturnValue(proof.promise);
    reads.context.mockReturnValue(context.promise);
    reads.gifts.mockReturnValue(gifts.promise);
    const { createArtistStorefrontPage } =
      await import("./artist-page-factory");
    const Entry = createArtistStorefrontPage(locale);
    const streamed = stream(
      <Entry
        params={Promise.resolve({ handle: artist.content.view.handle })}
        searchParams={Promise.resolve({
          market: "TEST_MARKET",
          currency: "USD",
          sort: "PRICE_DESC",
          idol: "a0000000-0000-4000-8000-000000000099",
        })}
      />,
    );
    try {
      await vi.waitFor(() => expect(reads.catalog).toHaveBeenCalledOnce());
      expect(streamed.html()).toBe("");
      expect(reads.context).not.toHaveBeenCalled();
      proof.resolve(artist);
      await vi.waitFor(
        () => expect(streamed.html()).toContain('id="artist-title"'),
        { timeout: 300 },
      );
      expect(streamed.html()).toContain('rel="preload" as="image"');
      expect(streamed.html()).toContain('fetchPriority="high"');
      expect(reads.gifts).not.toHaveBeenCalled();
      context.resolve(
        storefrontContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STOREFRONT_CONTEXT",
          markets: [{ market: "TEST_MARKET", currencies: ["USD"] }],
          policies: [],
        }),
      );
      await vi.waitFor(() => expect(reads.gifts).toHaveBeenCalledOnce());
      expect(streamed.html()).not.toContain("Gift from the server directory");
      const query = reads.gifts.mock.calls[0]?.[0] as URLSearchParams;
      expect(Object.fromEntries(query)).toMatchObject({
        locale,
        market: "TEST_MARKET",
        currency: "USD",
        sort: "PRICE_DESC",
        idol: artist.content.view.id,
      });
    } finally {
      proof.resolve(artist);
      context.resolve(contextUnavailable);
      gifts.resolve(giftPage(locale));
      await streamed.ended;
      streamed.abort();
    }
    expect(streamed.errors).toEqual([]);
    expect(streamed.html()).toContain('id="artist-gifts"');
    expect(streamed.html()).toContain("Gift from the server directory");
    expect(streamed.html()).toContain(
      `/${locale}/gifts/streamed-gift?market=TEST_MARKET&amp;currency=USD&amp;sort=PRICE_DESC&amp;idol=${artist.content.view.id}`,
    );
  },
);

test("an unavailable commerce context retains the artist and fails the gift section closed", async () => {
  const context = deferred<StorefrontContextResponse>();
  const artist = publishedArtist("en");
  reads.catalog.mockResolvedValue(artist);
  reads.context.mockReturnValue(context.promise);
  const { createArtistStorefrontPage } = await import("./artist-page-factory");
  const Entry = createArtistStorefrontPage("en");
  const streamed = stream(
    <Entry
      params={Promise.resolve({ handle: artist.content.view.handle })}
      searchParams={Promise.resolve({ market: "TEST_MARKET", currency: "USD" })}
    />,
  );
  try {
    await vi.waitFor(
      () => expect(streamed.html()).toContain('id="artist-title"'),
      { timeout: 300 },
    );
  } finally {
    context.resolve(contextUnavailable);
    await streamed.ended;
    streamed.abort();
  }
  expect(streamed.errors).toEqual([]);
  expect(streamed.html()).toContain("data-gift-directory-section");
  expect(streamed.html()).not.toContain("data-gift-link");
  expect(streamed.html()).not.toContain('data-outcome="success"');
  expect(reads.gifts).not.toHaveBeenCalled();
});

test.each(SUPPORTED_LOCALES)(
  "%s homepage shows published gifts below artists without featured slots or choosing a market",
  async (locale) => {
    reads.catalog.mockImplementation(async (_path, _query, kind) =>
      kind === "homepage" ? publishedHome(locale) : directoryFixturePage([]),
    );
    const priced = giftPage(locale);
    if (priced.outcome !== "SUCCESS") throw new Error("Missing fixture");
    reads.browse.mockResolvedValue({
      ...priced,
      items: priced.items.map((item) => item.gift),
    });
    const streamed = await streamHome(locale);
    await streamed.ended;
    streamed.abort();
    expect(streamed.errors).toEqual([]);
    const html = streamed.html();
    expect(html).toContain("Gift from the server directory");
    expect(html.indexOf('id="gifts"')).toBeGreaterThan(
      html.indexOf('id="artists"'),
    );
    expect(html).toContain(`/${locale}/gifts/streamed-gift`);
    expect(html).not.toContain("data-market-choices");
    expect(html).not.toContain("giftEmpty");
    expect(reads.gifts).not.toHaveBeenCalled();
    expect(reads.browse).toHaveBeenCalledWith(
      expect.objectContaining({ locale, page: 1, pageSize: 12 }),
    );
  },
);

test("published gifts remain browsable when the homepage poster is unavailable", async () => {
  const priced = giftPage("en");
  if (priced.outcome !== "SUCCESS") throw new Error("Missing fixture");
  reads.browse.mockResolvedValue({
    ...priced,
    items: priced.items.map((item) => item.gift),
  });
  const streamed = await streamHome("en");
  await streamed.ended;
  streamed.abort();
  expect(streamed.errors).toEqual([]);
  expect(streamed.html()).toContain("Gift from the server directory");
  expect(streamed.html()).not.toContain("data-market-choices");
});

test("public homepage reads the published layout and never substitutes defaults after layout failure", async () => {
  reads.catalog.mockImplementation(async (_path, _query, kind) =>
    kind === "homepage" ? publishedHome("en") : directoryFixturePage([]),
  );
  reads.layout.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  const unavailablePage = await streamHome("en");
  await unavailablePage.ended;
  expect(unavailablePage.html()).not.toContain('id="hero-title"');
  expect(unavailablePage.html()).not.toContain('id="how-title"');
  expect(unavailablePage.html()).toContain("temporarily unavailable");
  unavailablePage.abort();
  const layout = createDefaultHomeLayout();
  layout.sections.reverse();
  reads.layout.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HOME_LAYOUT",
    source: "PUBLISHED",
    layout,
    version: 2,
    publicationId: "b0000000-0000-4000-8000-000000000001",
  });
  const published = await streamHome("en");
  await published.ended;
  expect(published.html().indexOf('id="gifts"')).toBeLessThan(
    published.html().indexOf('id="artists"'),
  );
  published.abort();
});
