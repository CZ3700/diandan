import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
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
test("published unscoped gift emits content metadata and Product without fetching invented pricing scope", async () => {
  mocks.gift.mockResolvedValue({
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
          requestedLocale: "en",
          resolvedLocale: "en",
          fallbackUsed: false,
          translationRevision: locales[0]!.translationRevision,
        },
        primaryMedia: {
          url: "https://media.test/gift.webp",
          width: 800,
          height: 800,
          alt: "Gift",
        },
      },
    },
  });
  mocks.entity.mockResolvedValue({
    schemaVersion: 1,
    locator: { kind: "GIFT", handle: "gift" },
    publication,
    locales,
  });
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
