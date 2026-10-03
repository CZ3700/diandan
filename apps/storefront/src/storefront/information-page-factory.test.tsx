import { beforeEach, expect, test, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("../server/public-information-pages", () => ({
  readPublicInformationPage: read,
}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({
    siteOrigin: "https://shop.example.invalid",
  }),
  loadStorefrontPresentationConfig: () => ({ name: "TEST" }),
}));
vi.mock("./storefront-page-shell", () => ({ StorefrontPageShell: () => null }));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => ({ fallbackNotice: "English fallback" }),
}));
import { createInformationPage } from "./information-page-factory";
const id = "a0000000-0000-4000-8000-000000000001";
const snapshot = {
  outcome: "SUCCESS",
  resolvedLocale: "zh-CN",
  fallbackUsed: false,
  availableLocales: ["en", "zh-CN"],
  document: {
    pageKey: "FAQ",
    locale: "zh-CN",
    revisionId: id,
    structure: { sectionIds: [id], contactEmail: null },
    fields: {
      title: "测试问题",
      summary: "测试说明",
      sections: [{ id, heading: "问题？", body: "内容" }],
    },
  },
};
beforeEach(() => {
  read.mockReset().mockResolvedValue(snapshot);
  vi.stubEnv("FAN_SUPPORT_DEPLOYMENT_ENV", "production");
});
test("metadata uses the same published document and proven locale cluster, keeping browser context out of canonical", async () => {
  const { generateMetadata } = createInformationPage("zh-CN", "FAQ");
  const props = {
    params: Promise.resolve({}),
    searchParams: Promise.resolve({}),
  };
  const metadata = await generateMetadata(props);
  expect(metadata.title).toBe(snapshot.document.fields.title);
  expect(metadata.alternates).toEqual({
    canonical: "https://shop.example.invalid/zh-CN/faq",
    languages: {
      en: "https://shop.example.invalid/en/faq",
      "zh-CN": "https://shop.example.invalid/zh-CN/faq",
      "x-default": "https://shop.example.invalid/en/faq",
    },
  });
  expect(metadata.robots).toEqual({ index: true, follow: true });
  const scoped = await generateMetadata({
    ...props,
    searchParams: Promise.resolve({ token: "private", market: "TEST" }),
  });
  expect(JSON.stringify(scoped)).not.toContain("private");
  expect(scoped.robots).toEqual({ index: false, follow: true });
  vi.unstubAllEnvs();
});
test("fallback is not indexed and outage does not become a successful blank information page", async () => {
  const page = createInformationPage("zh-CN", "FAQ"),
    props = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };
  read.mockResolvedValue({
    ...snapshot,
    fallbackUsed: true,
    resolvedLocale: "en",
    availableLocales: ["en"],
    document: { ...snapshot.document, locale: "en" },
  });
  const metadata = await page.generateMetadata(props);
  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(metadata.alternates?.languages).toEqual({});
  expect(metadata.openGraph).toMatchObject({ locale: "en" });
  read.mockResolvedValue({ outcome: "FAILURE", code: "CONTENT_UNAVAILABLE" });
  await expect(page.Page(props)).rejects.toThrow(
    "Information page unavailable",
  );
  vi.unstubAllEnvs();
});
