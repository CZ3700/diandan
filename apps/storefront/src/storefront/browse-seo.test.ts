import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
vi.mock("server-only", () => ({}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({ siteOrigin: "https://store.test" }),
  loadStorefrontPresentationConfig: () => ({ name: "Test studio" }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => ({
    artistTitle: "Artists",
    artistBody: "Discover artists",
    navHome: "Home",
    navArtists: "Artists",
  }),
}));
const mocks = vi.hoisted(() => ({
  home: vi.fn(),
  idol: vi.fn(),
  directory: vi.fn(),
  entity: vi.fn(),
  context: vi.fn(),
}));
vi.mock("./storefront-page-reads", () => ({
  readStorefrontHomepage: mocks.home,
  readStorefrontIdol: mocks.idol,
  readStorefrontDirectory: mocks.directory,
  readCommerceContext: mocks.context,
}));
vi.mock("../server/storefront-seo", () => ({ readSeoEntity: mocks.entity }));
import { loadBrowseSeo } from "./browse-seo";
const publication = {
  id: "a1000000-0000-4000-8000-000000000001",
  revisionId: "a2000000-0000-4000-8000-000000000001",
  manifestHash: "a".repeat(64),
  publishedAt: "2026-09-07T00:00:00Z",
};
test("home metadata binds exact publication and current hero eligibility", async () => {
  const locales = SUPPORTED_LOCALES.map((locale, i) => ({
    locale,
    translationRevision: `a3000000-0000-4000-8000-00000000000${i}`,
    lastModified: publication.publishedAt,
  }));
  mocks.entity.mockResolvedValue({
    schemaVersion: 1,
    locator: { kind: "HOMEPAGE" },
    publication,
    locales,
  });
  mocks.home.mockResolvedValue({
    outcome: "SUCCESS",
    homepage: {
      publication,
      content: {
        view: {
          seoTitle: "Published home",
          seoDescription: "Published description",
          localeContext: {
            schemaVersion: 1,
            requestedLocale: "en",
            resolvedLocale: "en",
            fallbackUsed: false,
            translationRevision: locales[0]!.translationRevision,
          },
          heroDesktop: {
            url: "https://media.test/hero.webp",
            alt: "Hero",
            width: 1600,
            height: 900,
          },
        },
      },
    },
    slots: [],
  });
  mocks.directory.mockResolvedValue({ outcome: "SUCCESS", items: [] });
  const result = await loadBrowseSeo("en", "home", undefined, {});
  expect(result.metadata.alternates).toMatchObject({
    canonical: "https://store.test/en",
    languages: {
      "x-default": "https://store.test/en",
      th: "https://store.test/th",
    },
  });
  expect(result.metadata.openGraph).toMatchObject({ title: "Published home" });
  mocks.directory.mockResolvedValue({
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  const failedDirectory = await loadBrowseSeo("en", "home", undefined, {});
  expect(failedDirectory.metadata.robots).toMatchObject({ index: false });
  expect(failedDirectory.metadata.alternates?.languages).toEqual({});
  expect(failedDirectory.page).toBeNull();
  mocks.directory.mockResolvedValue({ outcome: "SUCCESS", items: [] });
  mocks.home.mockResolvedValue({
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  const failed = await loadBrowseSeo("en", "home", undefined, {});
  expect(failed.metadata.alternates?.languages).toEqual({});
  expect(failed.page).toBeNull();
});
test("missing artist produces no structured entity or alternates", async () => {
  mocks.idol.mockResolvedValue({ outcome: "FAILURE", code: "NOT_FOUND" });
  mocks.entity.mockResolvedValue(undefined);
  const result = await loadBrowseSeo("ja", "artist", "missing", {});
  expect(result.metadata.robots).toMatchObject({ index: false });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.page).toBeNull();
});
test("artist price context requires a currently available market and currency", async () => {
  const locales = SUPPORTED_LOCALES.map((locale, i) => ({
    locale,
    translationRevision: `a3000000-0000-4000-8000-00000000000${i}`,
    lastModified: publication.publishedAt,
  }));
  mocks.entity.mockResolvedValue({
    schemaVersion: 1,
    locator: { kind: "IDOL", handle: "artist" },
    publication,
    locales,
  });
  mocks.idol.mockResolvedValue({
    outcome: "SUCCESS",
    publication,
    content: {
      kind: "IDOL",
      view: {
        displayName: "Artist",
        seoTitle: "Artist",
        seoDescription: "Biography",
        localeContext: {
          schemaVersion: 1,
          requestedLocale: "en",
          resolvedLocale: "en",
          fallbackUsed: false,
          translationRevision: locales[0]!.translationRevision,
        },
        portrait: { url: "https://media.test/artist.webp" },
        heroDesktop: {
          url: "https://media.test/hero.webp",
          alt: "Hero",
          width: 1600,
          height: 900,
        },
      },
    },
  });
  mocks.context.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: [],
    policies: [],
  });
  const result = await loadBrowseSeo("en", "artist", "artist", {
    market: "UNKNOWN",
    currency: "XXX",
  });
  expect(result.metadata.alternates?.languages).toEqual({});
  expect(result.page).toBeNull();
});
