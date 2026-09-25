import { beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
vi.mock("server-only", () => ({}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({ siteOrigin: "https://store.test" }),
  loadStorefrontPresentationConfig: () => ({ name: "Test studio" }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => ({
    giftTitle: "Gift collection",
    giftBody: "Discover gifts",
    marketChoose: "Choose region",
    navHome: "Home",
    navGifts: "Gifts",
    giftPaginationPage: "Page {page} of {total}",
  }),
}));
const mocks = vi.hoisted(() => ({
  gift: vi.fn(),
  commerce: vi.fn(),
  entity: vi.fn(),
}));
vi.mock("./gift-page-reads", () => ({
  giftRead: mocks.gift,
  commerceRead: mocks.commerce,
  policyRead: vi.fn(),
  giftDirectoryRead: vi.fn(),
  readCommerceContext: vi.fn(),
}));
vi.mock("../server/storefront-seo", () => ({ readSeoEntity: mocks.entity }));
import { loadGiftSeo } from "./gift-seo";
const publication = {
  id: "a1000000-0000-4000-8000-000000000001",
  revisionId: "a2000000-0000-4000-8000-000000000001",
  manifestHash: "a".repeat(64),
  publishedAt: "2026-09-07T00:00:00Z",
};
const locales = SUPPORTED_LOCALES.map((locale, i) => ({
  locale,
  translationRevision: `a3000000-0000-4000-8000-00000000000${i}`,
  lastModified: publication.publishedAt,
}));
function useGift(locale: SupportedLocale = "en") {
  const content = {
    outcome: "SUCCESS",
    publication,
    content: {
      kind: "GIFT",
      view: {
        title: "Published gift",
        shortDescription: "Gift description",
        seoTitle: "Gift search title",
        seoDescription: "Gift search description",
        localeContext: {
          schemaVersion: 1,
          requestedLocale: locale,
          resolvedLocale: locale,
          fallbackUsed: false,
          translationRevision: locales.find((row) => row.locale === locale)!
            .translationRevision,
        },
        primaryMedia: {
          url: "https://media.test/gift.webp",
          width: 800,
          height: 800,
          alt: "Gift",
        },
      },
    },
  };
  mocks.gift.mockResolvedValue(content);
  const scoped = {
    ...content,
    kind: "STOREFRONT_GIFT",
    market: "GLOBAL",
    currency: "USD",
    recipient: { kind: "NONE" },
    offers: [
      {
        giftVariantId: "2abc0000-0000-4000-8000-000000000001",
        price: { unitAmountMinor: 1200 },
        availability: "AVAILABLE",
        reason: null,
      },
    ],
  };
  mocks.commerce.mockResolvedValue(scoped);
  mocks.entity.mockResolvedValue({
    schemaVersion: 1,
    locator: { kind: "GIFT", handle: "gift" },
    publication,
    locales,
  });
  return { content, scoped };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  useGift();
});

test("published unscoped gift emits content metadata and Product without fetching invented pricing scope", async () => {
  const result = await loadGiftSeo("en", "gift", "gift", {});
  expect(result.metadata.alternates).toMatchObject({
    canonical: "https://store.test/en/gifts/gift",
    languages: {
      "x-default": "https://store.test/en/gifts/gift",
      th: "https://store.test/th/gifts/gift",
    },
  });
  expect(result.metadata.openGraph).toMatchObject({
    title: "Gift search title",
  });
  expect(mocks.commerce).not.toHaveBeenCalled();
  expect(result.product).toMatchObject({ "@type": "Product" });
  expect(result.product).not.toHaveProperty("offers");
});
test("missing current publication never emits Product or hreflang", async () => {
  mocks.gift.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  mocks.entity.mockResolvedValue(undefined);
  const result = await loadGiftSeo("en", "gift", "missing", {});
  expect(result.metadata.robots).toMatchObject({ index: false });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.product).toBeNull();
});

const query = { market: "GLOBAL", currency: "USD" };
test.each(SUPPORTED_LOCALES)(
  "%s uses scoped content for its title, image, language proof and Product",
  async (locale) => {
    const { scoped } = useGift(locale);
    const current = {
      ...scoped,
      content: {
        ...scoped.content,
        view: {
          ...scoped.content.view,
          title: "Current scoped gift",
          seoTitle: "Current scoped SEO",
          seoDescription: "Current scoped description",
          primaryMedia: {
            ...scoped.content.view.primaryMedia,
            url: "https://media.test/current.webp",
          },
        },
      },
    };
    mocks.commerce.mockResolvedValue(current);
    const result = await loadGiftSeo(locale, "gift", "gift", query);
    expect(result.metadata.title).toBe("Current scoped SEO");
    expect(result.metadata.description).toBe("Current scoped description");
    expect(result.metadata.openGraph).toMatchObject({
      images: [{ url: "https://media.test/current.webp" }],
    });
    expect(result.metadata.alternates?.languages).toHaveProperty(locale);
    expect(result.product).toMatchObject({
      name: "Current scoped gift",
      offers: { price: "12.00", priceCurrency: "USD" },
    });
    expect(mocks.gift).not.toHaveBeenCalled();
    expect(mocks.commerce).toHaveBeenCalledExactlyOnceWith(
      locale,
      "gift",
      "GLOBAL",
      "USD",
      undefined,
    );
  },
);

test("scoped metadata does not wait for a pending unused unscoped read", async () => {
  const { content } = useGift();
  let resolve!: (value: typeof content) => void;
  mocks.gift.mockReturnValue(
    new Promise<typeof content>((done) => {
      resolve = done;
    }),
  );
  let settled = false;
  const pending = loadGiftSeo("en", "gift", "gift", query).then((result) => {
    settled = true;
    return result;
  });
  try {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    expect(settled).toBe(true);
    expect(mocks.gift).not.toHaveBeenCalled();
  } finally {
    resolve(content);
    await pending;
  }
});

test("unavailable-market metadata retains the published introduction without offers or indexing", async () => {
  mocks.commerce.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "MARKET_UNAVAILABLE",
  });
  const result = await loadGiftSeo("en", "gift", "gift", query);
  expect(result.metadata.title).toBe("Gift search title");
  expect(result.metadata.robots).toMatchObject({ index: false });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.product).toBeNull();
  expect(mocks.gift).toHaveBeenCalledExactlyOnceWith("en", "gift");
});

test.each(["NOT_FOUND", "CONTENT_UNAVAILABLE", "INVALID_QUERY"])(
  "scoped %s metadata cannot recover with separate unscoped content",
  async (code) => {
    mocks.commerce.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    });
    const result = await loadGiftSeo("en", "gift", "gift", query);
    expect(result.metadata.title).toBe("Gift collection");
    expect(result.metadata.robots).toMatchObject({ index: false });
    expect(result.metadata.alternates?.languages).toEqual({});
    expect(result.product).toBeNull();
    expect(mocks.gift).not.toHaveBeenCalled();
  },
);

test("scoped unexpected rejection stays rejected without unscoped recovery", async () => {
  mocks.commerce.mockRejectedValue(new Error("Synthetic scoped failure"));
  await expect(loadGiftSeo("en", "gift", "gift", query)).rejects.toThrow(
    "Synthetic scoped failure",
  );
  expect(mocks.gift).not.toHaveBeenCalled();
});

test.each([
  ["id", "a1000000-0000-4000-8000-000000000002"],
  ["revisionId", "a2000000-0000-4000-8000-000000000002"],
  ["manifestHash", "b".repeat(64)],
  ["publishedAt", "2026-09-08T00:00:00Z"],
] as const)(
  "scoped publication %s mismatch excludes hreflang and Product",
  async (key, value) => {
    const { scoped } = useGift();
    mocks.commerce.mockResolvedValue({
      ...scoped,
      publication: { ...publication, [key]: value },
    });
    const result = await loadGiftSeo("en", "gift", "gift", query);
    expect(result.metadata.robots).toMatchObject({ index: false });
    expect(result.metadata.alternates?.languages).toEqual({});
    expect(result.product).toBeNull();
  },
);

test.each(["translation", "fallback", "recipient-fallback"])(
  "scoped %s cannot produce an indexable Product",
  async (kind) => {
    const { scoped } = useGift();
    const localeContext = {
      ...scoped.content.view.localeContext,
      ...(kind === "translation"
        ? { translationRevision: "a3000000-0000-4000-8000-000000000009" }
        : { fallbackUsed: true, resolvedLocale: "zh-CN" }),
    };
    mocks.commerce.mockResolvedValue(
      kind === "recipient-fallback"
        ? {
            ...scoped,
            recipient: { kind: "PUBLISHED", idol: { localeContext } },
          }
        : {
            ...scoped,
            content: {
              ...scoped.content,
              view: { ...scoped.content.view, localeContext },
            },
          },
    );
    const result = await loadGiftSeo("en", "gift", "gift", query);
    expect(result.metadata.robots).toMatchObject({ index: false });
    expect(result.metadata.alternates?.languages).toEqual({});
    expect(result.product).toBeNull();
  },
);

test.each([
  { ...query, variant: "invalid" },
  { ...query, market: ["GLOBAL", "OTHER"] },
  { market: "", currency: "" },
])(
  "invalid selection preserves unscoped lookup and excludes pricing: %j",
  async (values) => {
    const result = await loadGiftSeo("en", "gift", "gift", values);
    expect(mocks.gift).toHaveBeenCalledExactlyOnceWith("en", "gift");
    expect(mocks.commerce).not.toHaveBeenCalled();
    expect(result.metadata.alternates?.languages).toEqual({});
    expect(result.product).toBeNull();
  },
);

test("unknown valid variant cannot borrow another variant's offer", async () => {
  const result = await loadGiftSeo("en", "gift", "gift", {
    ...query,
    variant: "2abc0000-0000-4000-8000-000000000009",
  });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.product).toBeNull();
});

test("daily scoped original-language content keeps its metadata but cannot pretend to be a translated Product", async () => {
  const { scoped } = useGift();
  mocks.commerce.mockResolvedValue({
    ...scoped,
    content: {
      ...scoped.content,
      view: {
        ...scoped.content.view,
        seoTitle: "真实原文礼物",
        localeContext: {
          schemaVersion: 2,
          publicationMode: "DIRECT_OPERATOR_V1",
          sourceLocale: "zh-CN",
          requestedLocale: "en",
          resolvedLocale: "zh-CN",
          fallbackUsed: true,
          translationRevision: "cc000000-0000-4000-8000-000000000001",
        },
      },
    },
  });
  const result = await loadGiftSeo("en", "gift", "gift", query);
  expect(result.metadata.title).toBe("真实原文礼物");
  expect(result.metadata.robots).toMatchObject({ index: false });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.product).toBeNull();
  expect(mocks.gift).not.toHaveBeenCalled();
});
