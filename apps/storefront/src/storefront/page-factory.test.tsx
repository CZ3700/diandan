import { PassThrough } from "node:stream";
import { isValidElement, type ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
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

const reads = vi.hoisted(() => ({
  catalog: vi.fn(),
  context: vi.fn(),
  seo: vi.fn(),
  gifts: vi.fn(),
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

function publishedArtist(locale: (typeof SUPPORTED_LOCALES)[number]) {
  const home = publishedHome(locale);
  if (home.outcome !== "SUCCESS") throw new Error("Missing test homepage");
  const slot = home.slots[0];
  if (slot?.status !== "AVAILABLE" || slot.content.content.kind !== "IDOL")
    throw new Error("Missing test artist publication");
  return { ...slot.content, content: slot.content.content };
}

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
  reads.catalog
    .mockReset()
    .mockImplementation(async (_path, _query, kind) =>
      kind === "directory" ? directoryFixturePage([]) : unavailable,
    );
  reads.context.mockReset().mockResolvedValue(contextUnavailable);
  reads.seo.mockReset().mockReturnValue(null);
  reads.gifts.mockReset();
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
    "/en/policies/test-studio-terms?currency=JPY&amp;market=TEST_MARKET",
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
