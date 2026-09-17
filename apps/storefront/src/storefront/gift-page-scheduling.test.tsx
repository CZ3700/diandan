import { PassThrough } from "node:stream";
import {
  Children,
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import { readFileSync } from "node:fs";
import { CartProvider } from "./cart-provider";
import { SiteHeader } from "./site-header";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  publishedGiftCommerceResponseSchema,
  storefrontGiftResponseSchema,
  storefrontContextResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { directoryFixturePage } from "./directory-fixture";

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
  gift: vi.fn(),
  commerce: vi.fn(),
  artists: vi.fn(),
  policy: vi.fn(),
  cookieHas: vi.fn(() => false),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: reads.cookieHas }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: reads.copy,
}));
vi.mock("./gift-page-reads", () => ({
  readCommerceContext: reads.context,
  giftRead: reads.gift,
  commerceRead: reads.commerce,
  artistRead: reads.artists,
  policyRead: reads.policy,
  giftDirectoryRead: vi.fn(),
}));
vi.mock("./site-header", () => ({ SiteHeader: () => null }));
vi.mock("./gift-directory-section", () => ({
  GiftDirectorySection: () => null,
}));
vi.mock("./gift-seo", () => ({
  GiftPageSeo: () => null,
  loadGiftSeo: vi.fn(),
}));

import { createGiftStorefrontPage } from "./gift-page-factory";
import { createGiftDirectoryPage } from "./gift-directory-page-factory";

const variantId = "2abc0000-0000-4000-8000-000000000001";
function fixture(locale: SupportedLocale = "en", selected = false) {
  const artists = directoryFixturePage([1]);
  if (artists.outcome !== "SUCCESS" || !artists.items[0])
    throw new Error("Missing fixture artist");
  const artist = artists.items[0];
  artist.localeContext = {
    schemaVersion: 1,
    requestedLocale: locale,
    resolvedLocale: locale,
    fallbackUsed: false,
  };
  const gift = publishedGiftCommerceResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLISHED_GIFT_COMMERCE",
    publication: {
      id: "50000000-0000-4000-8000-000000000001",
      revisionId: "60000000-0000-4000-8000-000000000001",
      manifestHash: "a".repeat(64),
      publishedAt: "2026-09-07T00:00:00.000Z",
    },
    classification: { kind: "LEGACY" },
    content: {
      kind: "GIFT",
      details: { format: "LEGACY_TEXT", text: "Verified gift details" },
      view: {
        schemaVersion: 1,
        id: "10000000-0000-4000-8000-000000000001",
        handle: "rose-palace",
        status: "active",
        localeContext: artist.localeContext,
        title: "Verified gift before directory",
        subtitle: "Published gift introduction",
        shortDescription: "Verified gift summary",
        description: "Verified gift details",
        fulfillmentDescription: "The studio delivers to the artist.",
        category: "OTHER",
        contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        shippingMode: "internal_to_idol",
        primaryMedia: {
          ...artist.portrait,
          url: "https://media.invalid/gift.webp",
        },
        gallery: [],
        variants: [
          {
            schemaVersion: 1,
            id: variantId,
            label: "Verified option",
            status: "active",
            inventoryPolicy: "TRACKED",
          },
        ],
        safetyNotice: "Fictional test only",
        seoTitle: "Verified gift",
        seoDescription: "Verified gift description",
      },
    },
  });
  if (gift.outcome !== "SUCCESS") throw new Error("Missing fixture gift");
  const commerce = storefrontGiftResponseSchema.parse({
    ...gift,
    kind: "STOREFRONT_GIFT",
    market: "GLOBAL",
    currency: "USD",
    recipient: selected
      ? {
          kind: "PUBLISHED",
          idol: {
            schemaVersion: artist.schemaVersion,
            id: artist.id,
            handle: artist.handle,
            status: artist.status,
            acceptingGifts: artist.acceptingGifts,
            localeContext: artist.localeContext,
            displayName: artist.displayName,
            portrait: artist.portrait,
          },
        }
      : { kind: "NONE" },
    offers: [
      {
        giftVariantId: variantId,
        price: {
          priceId: "40000000-0000-4000-8000-000000000001",
          priceRevision: 2,
          unitAmountMinor: 1200,
        },
        availability: "AVAILABLE",
        reason: null,
        requiresRecipient: !selected,
        stock: { kind: "TRACKED", availableQuantity: 3 },
        maxQuantity: 3,
      },
    ],
  });
  const context = storefrontContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: [{ market: "GLOBAL", currencies: ["USD", "JPY"] }],
    policies: [{ policyKey: "studio-delivery", kind: "DELIVERY" }],
  });
  return { gift, commerce, context, artists, artist };
}
function useFixture(locale: SupportedLocale = "en", selected = false) {
  const data = fixture(locale, selected);
  for (const key of ["context", "gift", "commerce", "artists"] as const)
    reads[key].mockResolvedValue(data[key]);
  return data;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    onShellError(error) {
      errors.push(error);
      response.end();
    },
    onError(error) {
      errors.push(error);
    },
  });
  return { html: () => html, ended, errors, abort: () => rendering.abort() };
}
const missing = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "NOT_FOUND",
};
const query = { market: "GLOBAL", currency: "USD" };
const Page = createGiftStorefrontPage("en", "gift");
function render(
  values: Readonly<Record<string, string | string[] | undefined>> = query,
  handle = "rose-palace",
) {
  return Page({
    params: Promise.resolve({ handle }),
    searchParams: Promise.resolve(values),
  });
}
beforeEach(() => {
  for (const read of Object.values(reads)) read.mockReset();
  reads.copy.mockImplementation((locale: SupportedLocale) =>
    loadStorefrontCopy(locale, { requireApproved: false }),
  );
  useFixture();
  reads.policy.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

test("a policy context rejection is consumed immediately while copy is still pending", async () => {
  const copy = await loadStorefrontCopy("en", { requireApproved: false });
  const slowCopy = deferred<typeof copy>();
  reads.copy.mockReturnValue(slowCopy.promise);
  const failure = new Error("Synthetic context failure");
  reads.context.mockRejectedValue(failure);
  const Entry = createGiftStorefrontPage("en", "policy");
  let rejected: unknown;
  const pending = Promise.resolve(
    Entry({
      params: Promise.resolve({ handle: "studio-delivery" }),
      searchParams: Promise.resolve({}),
    }),
  ).catch((error: unknown) => {
    rejected = error;
  });
  try {
    // Drain scheduling microtasks, without yielding an event-loop turn with an
    // intentionally unhandled rejection in the unchanged implementation.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(rejected).toBe(failure);
  } finally {
    slowCopy.resolve(copy);
    await pending;
  }
});

test.each(["context", "commerce"] as const)(
  "a slow %s read does not serialize independent gift page reads",
  async (blocked) => {
    const data = fixture();
    const slow = deferred<(typeof data)[typeof blocked]>();
    reads[blocked].mockReturnValue(slow.promise);
    const pending = render();
    try {
      // All inputs are resolved promises; allow the page's scheduling work to settle.
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(reads.context).toHaveBeenCalledOnce();
      expect(reads.gift).not.toHaveBeenCalled();
      expect(reads.commerce).toHaveBeenCalledWith(
        "en",
        "rose-palace",
        "GLOBAL",
        "USD",
        undefined,
      );
      expect(reads.artists).toHaveBeenCalledWith("en", undefined);
    } finally {
      slow.resolve(data[blocked]);
      await pending;
    }
  },
);

test.each(["gift", "commerce"] as const)(
  "a missing %s never returns a page shell",
  async (read) => {
    reads[read].mockResolvedValue(missing);
    await expect(render(read === "gift" ? {} : query)).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  },
);

test("an invalid handle never queries a gift or scoped commerce", async () => {
  await expect(render(query, "bad/handle")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(reads.gift).not.toHaveBeenCalled();
  expect(reads.commerce).not.toHaveBeenCalled();
});

test.each([
  ["missing", {}],
  ["invalid empty", { market: "", currency: "" }],
] as const)("%s market never invents a scoped offer", async (_, values) => {
  await render(values);
  expect(reads.commerce).not.toHaveBeenCalled();
});

test.each(["gift", "commerce"] as const)(
  "an unexpected %s rejection never returns a page shell",
  async (read) => {
    reads[read].mockRejectedValue(new Error("read unavailable"));
    await expect(render(read === "gift" ? {} : query)).rejects.toThrow(
      "read unavailable",
    );
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s streams verified gift, selected recipient and price while artists and context remain pending",
  async (locale) => {
    const data = useFixture(locale, true);
    const artists = deferred<typeof data.artists>();
    const context = deferred<typeof data.context>();
    reads.artists.mockReturnValue(artists.promise);
    reads.context.mockReturnValue(context.promise);
    const values = {
      ...query,
      idol: data.artist.id,
      variant: variantId,
      cart: "preserved",
    };
    const Entry = createGiftStorefrontPage(locale, "gift");
    const rendered = stream(
      <Entry
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve(values)}
      />,
    );
    try {
      await vi.waitFor(() =>
        expect(reads.artists).toHaveBeenCalledWith(locale, data.artist.id),
      );
      await vi.waitFor(
        () =>
          expect(rendered.html()).toContain("Verified gift before directory"),
        { timeout: 300 },
      );
      expect(rendered.html()).toContain("gift.webp");
      expect(rendered.html()).toContain('fetchPriority="high"');
      expect(rendered.html()).toContain('value="1200"');
      expect(rendered.html()).toContain(
        `data-selected-recipient="${data.artist.id}"`,
      );
      expect(rendered.html()).not.toContain(
        'data-gift-recipient-picker="true"',
      );
      expect(rendered.html()).not.toContain('data-market="GLOBAL"');
      expect(rendered.html()).toContain('data-gift-recipient-pending="true"');
      expect(rendered.html()).toContain('data-gift-context-pending="true"');
    } finally {
      artists.resolve(data.artists);
      context.resolve(data.context);
      await rendered.ended;
      rendered.abort();
    }
    expect(rendered.errors).toEqual([]);
    expect(rendered.html()).toContain('data-gift-recipient-picker="true"');
    expect(rendered.html()).toContain('data-market="GLOBAL"');
    const params = new URLSearchParams(values);
    expect(rendered.html()).toContain(
      `/${locale}/policies/studio-delivery?${params.toString().replaceAll("&", "&amp;")}`,
    );
    expect(rendered.html()).toContain(
      `/${locale}/gifts/rose-palace?market=GLOBAL&amp;currency=JPY&amp;idol=${data.artist.id}&amp;cart=preserved`,
    );
  },
);

test.each(["context", "artists"] as const)(
  "a slow %s cannot delay a missing gift's pre-shell 404",
  async (key) => {
    const data = fixture();
    const slow = deferred<(typeof data)[typeof key]>();
    reads[key].mockReturnValue(slow.promise);
    reads.commerce.mockResolvedValue(missing);
    let error: unknown;
    const pending = Promise.resolve(render()).catch((caught: unknown) => {
      error = caught;
    });
    try {
      await vi.waitFor(
        () => expect(error).toEqual(new Error("NEXT_NOT_FOUND")),
        { timeout: 300 },
      );
    } finally {
      slow.resolve(data[key]);
      await pending;
    }
  },
);

test.each(["gift", "commerce"] as const)(
  "a pending %s proof still prevents any gift shell or price",
  async (key) => {
    const data = useFixture("en", true);
    const critical = deferred<(typeof data)[typeof key]>();
    reads[key].mockReturnValue(critical.promise);
    const rendered = stream(
      <Page
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve(
          key === "gift" ? {} : { ...query, idol: data.artist.id },
        )}
      />,
    );
    try {
      await vi.waitFor(() => expect(reads[key]).toHaveBeenCalledOnce());
      expect(rendered.html()).toBe("");
    } finally {
      critical.resolve(data[key]);
      await rendered.ended;
      rendered.abort();
    }
    expect(rendered.errors).toEqual([]);
    expect(rendered.html()).toContain("Verified gift before directory");
    if (key === "commerce") expect(rendered.html()).toContain('value="1200"');
    else expect(rendered.html()).not.toContain('value="1200"');
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s keeps unscoped gift content while delayed context and selected-artist errors remain explicit",
  async (locale) => {
    const data = useFixture(locale);
    const artists = deferred<unknown>();
    const context = deferred<unknown>();
    reads.artists.mockReturnValue(artists.promise);
    reads.context.mockReturnValue(context.promise);
    const Entry = createGiftStorefrontPage(locale, "gift");
    const rendered = stream(
      <Entry
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve({ idol: data.artist.id })}
      />,
    );
    try {
      await vi.waitFor(
        () =>
          expect(rendered.html()).toContain("Verified gift before directory"),
        { timeout: 300 },
      );
      expect(reads.commerce).not.toHaveBeenCalled();
      expect(rendered.html()).not.toContain('value="1200"');
      expect(rendered.html()).not.toContain("data-selected-recipient=");
    } finally {
      artists.resolve({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "ANCHOR_NOT_FOUND",
      });
      context.resolve({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "COMMERCE_UNAVAILABLE",
      });
      await rendered.ended;
      rendered.abort();
    }
    const copy = await loadStorefrontCopy(locale, { requireApproved: false });
    expect(rendered.errors).toEqual([]);
    expect(rendered.html()).toContain(copy.giftRecipientUnavailable);
    expect(rendered.html()).toContain(copy.contentErrorBody);
    expect(rendered.html()).not.toContain("data-selected-recipient=");
  },
);

test.each(["context", "artists"] as const)(
  "an unexpected noncritical %s rejection renders its existing safe error",
  async (key) => {
    const data = useFixture();
    reads[key].mockRejectedValue(new Error("Synthetic upstream failure"));
    const rendered = stream(
      <Page
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve({ idol: data.artist.id })}
      />,
    );
    await rendered.ended;
    rendered.abort();
    const copy = await loadStorefrontCopy("en", { requireApproved: false });
    expect(rendered.errors).toEqual([]);
    expect(rendered.html()).toContain("Verified gift before directory");
    expect(rendered.html()).toContain(
      key === "context" ? copy.contentErrorBody : copy.giftRecipientUnavailable,
    );
    expect(rendered.html()).not.toContain("Synthetic upstream failure");
  },
);

test("a delayed directory cannot replace the current scoped recipient or re-enable its paused offer", async () => {
  const data = useFixture("en", true);
  if (
    data.commerce.outcome !== "SUCCESS" ||
    data.commerce.recipient.kind !== "PUBLISHED"
  )
    throw new Error("Missing fixture recipient");
  const paused = storefrontGiftResponseSchema.parse({
    ...data.commerce,
    recipient: {
      kind: "PUBLISHED",
      idol: {
        ...data.commerce.recipient.idol,
        status: "paused",
        acceptingGifts: false,
      },
    },
    offers: data.commerce.offers.map((offer) => ({
      ...offer,
      availability: "UNAVAILABLE",
      reason: "RECIPIENT_UNAVAILABLE",
      maxQuantity: 0,
    })),
  });
  reads.commerce.mockResolvedValue(paused);
  const artists = deferred<typeof data.artists>();
  reads.artists.mockReturnValue(artists.promise);
  const rendered = stream(
    <Page
      params={Promise.resolve({ handle: "rose-palace" })}
      searchParams={Promise.resolve({ ...query, idol: data.artist.id })}
    />,
  );
  try {
    await vi.waitFor(
      () =>
        expect(rendered.html()).toContain('data-availability="UNAVAILABLE"'),
      { timeout: 300 },
    );
    expect(rendered.html()).not.toContain('role="spinbutton"');
  } finally {
    artists.resolve(data.artists);
    await rendered.ended;
    rendered.abort();
  }
  const copy = await loadStorefrontCopy("en", { requireApproved: false });
  expect(rendered.errors).toEqual([]);
  expect(rendered.html()).toContain(copy.artistPaused);
  expect(rendered.html()).not.toContain('role="spinbutton"');
  expect(rendered.html()).toContain('value="1200"');
});

test("an unavailable requested market never invents an offer while its real choices stream later", async () => {
  const data = useFixture();
  reads.commerce.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "MARKET_UNAVAILABLE",
  });
  const context = deferred<typeof data.context>();
  reads.context.mockReturnValue(context.promise);
  const rendered = stream(
    <Page
      params={Promise.resolve({ handle: "rose-palace" })}
      searchParams={Promise.resolve(query)}
    />,
  );
  try {
    await vi.waitFor(
      () => expect(rendered.html()).toContain("Verified gift before directory"),
      { timeout: 300 },
    );
    expect(rendered.html()).not.toContain("data-gift-purchase=");
  } finally {
    context.resolve(data.context);
    await rendered.ended;
    rendered.abort();
  }
  const copy = await loadStorefrontCopy("en", { requireApproved: false });
  expect(rendered.errors).toEqual([]);
  expect(rendered.html()).toContain(copy.marketInvalid);
  expect(rendered.html()).toContain('data-currency="JPY"');
  expect(rendered.html()).not.toContain("data-gift-purchase=");
});

test.each([
  ["en", false],
  ["en", true],
  ["zh-CN", false],
  ["zh-CN", true],
] as const)(
  "%s streaming preserves the daily gift's actual original language with scoped=%s",
  async (locale, scoped) => {
    const data = useFixture(locale);
    const localeContext = {
      schemaVersion: 2,
      publicationMode: "DIRECT_OPERATOR_V1",
      sourceLocale: "zh-CN",
      requestedLocale: locale,
      resolvedLocale: "zh-CN",
      fallbackUsed: locale !== "zh-CN",
      translationRevision: "cc000000-0000-4000-8000-000000000001",
    };
    const daily = publishedGiftCommerceResponseSchema.parse({
      ...data.gift,
      content: {
        ...data.gift.content,
        view: {
          ...data.gift.content.view,
          title: "真实原文礼物",
          localeContext,
          primaryMedia: {
            ...data.gift.content.view.primaryMedia,
            schemaVersion: 2,
            localeContext,
          },
        },
      },
    });
    reads.gift.mockResolvedValue(daily);
    if (daily.outcome !== "SUCCESS") throw new Error("Missing daily gift");
    reads.commerce.mockResolvedValue(
      storefrontGiftResponseSchema.parse({
        ...data.commerce,
        content: daily.content,
      }),
    );
    const artists = deferred<typeof data.artists>();
    const context = deferred<typeof data.context>();
    reads.artists.mockReturnValue(artists.promise);
    reads.context.mockReturnValue(context.promise);
    const Entry = createGiftStorefrontPage(locale, "gift");
    const rendered = stream(
      <Entry
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve(scoped ? query : {})}
      />,
    );
    try {
      await vi.waitFor(
        () =>
          expect(rendered.html()).toContain(
            '<h1 lang="zh-CN">真实原文礼物</h1>',
          ),
        { timeout: 300 },
      );
      expect(rendered.html()).toContain(`class="storefront" lang="${locale}"`);
      if (scoped) {
        expect(reads.gift).not.toHaveBeenCalled();
        expect(rendered.html()).toContain('value="1200"');
      } else expect(rendered.html()).not.toContain("data-gift-purchase=");
    } finally {
      artists.resolve(data.artists);
      context.resolve(data.context);
      await rendered.ended;
      rendered.abort();
    }
    expect(rendered.errors).toEqual([]);
  },
);

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const result: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<Record<string, unknown>>(child))
      result.push(child, ...elements(child.props["children"] as ReactNode));
  });
  return result;
}
test.each(["gift", "gifts", "policy", "region"] as const)(
  "%s keeps its header and main inside exactly one shared cart provider",
  async (kind) => {
    const Entry =
      kind === "gifts"
        ? createGiftDirectoryPage("en")
        : createGiftStorefrontPage("en", kind);
    let tree = await Entry({
      params: Promise.resolve({
        handle: kind === "policy" ? "studio-delivery" : "rose-palace",
      }),
      searchParams: Promise.resolve(query),
    });
    if (tree.type === Suspense) {
      const child = tree.props.children as ReactElement;
      const renderPage = child.type as (
        props: unknown,
      ) => Promise<ReactElement>;
      tree = await renderPage(child.props);
    }
    const providers = elements(tree).filter(
      (element) => element.type === CartProvider,
    );
    expect(providers).toHaveLength(1);
    const provider = providers[0]!;
    expect(provider.key).toBe("en");
    expect(provider.props["locale"]).toBe("en");
    expect(provider.props["restoreOnLoad"]).toBe(false);
    const contents = elements(provider.props["children"] as ReactNode);
    expect(
      contents.filter((element) => element.type === SiteHeader),
    ).toHaveLength(1);
    expect(
      contents.filter(
        (element) =>
          element.type === "main" && element.props["id"] === "main-content",
      ),
    ).toHaveLength(1);
  },
);
test("the gift page preserves automatic restoration for a returning visitor", async () => {
  reads.cookieHas.mockReturnValueOnce(true);
  const Entry = createGiftStorefrontPage("en", "gift");
  const tree = await Entry({
    params: Promise.resolve({ handle: "rose-palace" }),
    searchParams: Promise.resolve(query),
  });
  const provider = elements(tree).find(
    (element) => element.type === CartProvider,
  );
  expect(provider?.props["restoreOnLoad"]).toBe(true);
});
test("the independent gift-family shell loads its own cart styles", () => {
  const source = readFileSync(
    new URL("./gift-page-factory.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toMatch(/import ["']\.\/cart\.css["'];/u);
});

test.each(SUPPORTED_LOCALES)(
  "%s streams the complete scoped gift without waiting for an unused unscoped read",
  async (locale) => {
    const data = useFixture(locale, true);
    const unused = deferred<typeof data.gift>();
    reads.gift.mockReturnValue(unused.promise);
    const Entry = createGiftStorefrontPage(locale, "gift");
    const rendered = stream(
      <Entry
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve({ ...query, idol: data.artist.id })}
      />,
    );
    try {
      await vi.waitFor(
        () =>
          expect(rendered.html()).toContain("Verified gift before directory"),
        { timeout: 300 },
      );
      expect(rendered.html()).toContain('value="1200"');
      expect(reads.commerce).toHaveBeenCalledOnce();
      expect(reads.gift).not.toHaveBeenCalled();
    } finally {
      unused.resolve(data.gift);
      await rendered.ended;
      rendered.abort();
    }
    expect(rendered.errors).toEqual([]);
  },
);

test.each(["CONTENT_UNAVAILABLE", "INVALID_QUERY"] as const)(
  "a scoped %s cannot be replaced by an independently successful content read",
  async (code) => {
    reads.commerce.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    });
    const rendered = stream(
      <Page
        params={Promise.resolve({ handle: "rose-palace" })}
        searchParams={Promise.resolve(query)}
      />,
    );
    await rendered.ended;
    rendered.abort();
    const copy = await loadStorefrontCopy("en", { requireApproved: false });
    expect(rendered.errors).toEqual([]);
    expect(rendered.html()).toContain(copy.contentErrorBody);
    expect(rendered.html()).not.toContain("Verified gift before directory");
    expect(rendered.html()).not.toContain('value="1200"');
    expect(reads.gift).not.toHaveBeenCalled();
  },
);

test("the unavailable-market introduction waits for its own published proof", async () => {
  const data = useFixture();
  reads.commerce.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "MARKET_UNAVAILABLE",
  });
  const content = deferred<typeof data.gift>();
  reads.gift.mockReturnValue(content.promise);
  const rendered = stream(
    <Page
      params={Promise.resolve({ handle: "rose-palace" })}
      searchParams={Promise.resolve(query)}
    />,
  );
  try {
    await vi.waitFor(() => expect(reads.gift).toHaveBeenCalledOnce());
    expect(rendered.html()).toBe("");
  } finally {
    content.resolve(data.gift);
    await rendered.ended;
    rendered.abort();
  }
  expect(rendered.errors).toEqual([]);
  expect(rendered.html()).toContain("Verified gift before directory");
  expect(rendered.html()).not.toContain('value="1200"');
});

test.each(["NOT_FOUND", "CONTENT_UNAVAILABLE", "reject"])(
  "unavailable-market introduction preserves its %s result",
  async (code) => {
    reads.commerce.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "MARKET_UNAVAILABLE",
    });
    if (code === "reject")
      reads.gift.mockRejectedValue(new Error("Synthetic introduction failure"));
    else
      reads.gift.mockResolvedValue({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
    if (code === "NOT_FOUND" || code === "reject") {
      await expect(render()).rejects.toThrow(
        code === "NOT_FOUND"
          ? "NEXT_NOT_FOUND"
          : "Synthetic introduction failure",
      );
    } else {
      const rendered = stream(
        <Page
          params={Promise.resolve({ handle: "rose-palace" })}
          searchParams={Promise.resolve(query)}
        />,
      );
      await rendered.ended;
      rendered.abort();
      const copy = await loadStorefrontCopy("en", { requireApproved: false });
      expect(rendered.errors).toEqual([]);
      expect(rendered.html()).toContain(copy.contentErrorBody);
      expect(rendered.html()).not.toContain("Verified gift before directory");
      expect(rendered.html()).not.toContain('value="1200"');
    }
    expect(reads.gift).toHaveBeenCalledExactlyOnceWith("en", "rose-palace");
  },
);
