import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const subject = await import("./information-sitemap").catch(() => undefined);
const read = vi.fn(async () => ({
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "INFORMATION_PAGE_INDEX" as const,
  locale: "en" as const,
  entries: [
    {
      pageKey: "FAQ" as const,
      title: "TEST",
      publicationId: "a0000000-0000-4000-8000-000000000001",
      publishedAt: "2026-09-29T00:00:00.000Z",
      availableLocales: ["en", "zh-CN"] as ("en" | "zh-CN")[],
    },
  ],
}));
test("information sitemap derives canonical/hreflang and lastmod from the one published projection", async () => {
  expect(subject?.informationSitemapResponse).toBeTypeOf("function");
  const response = await subject!.informationSitemapResponse(
    new Request("https://shop.example.invalid/en/information-sitemap.xml"),
    "https://shop.example.invalid",
    "en",
    read,
  );
  expect(response.status).toBe(200);
  const xml = await response.text();
  expect(xml).toContain("https://shop.example.invalid/en/faq");
  expect(xml).toContain('hreflang="zh-CN"');
  expect(xml).toContain('hreflang="x-default"');
  expect(xml).not.toContain('hreflang="ja"');
  expect(xml).not.toContain("TEST");
  expect(xml).toContain("2026-09-29T00:00:00.000Z");
  const etag = response.headers.get("etag")!;
  expect(
    (
      await subject!.informationSitemapResponse(
        new Request("https://shop.example.invalid/en/information-sitemap.xml", {
          headers: { "if-none-match": etag },
        }),
        "https://shop.example.invalid",
        "en",
        read,
      )
    ).status,
  ).toBe(304);
});
test("information sitemap rejects query parameters, mismatched locales and unavailable snapshots", async () => {
  expect(subject?.informationSitemapResponse).toBeTypeOf("function");
  expect(
    (
      await subject!.informationSitemapResponse(
        new Request(
          "https://shop.example.invalid/en/information-sitemap.xml?draft=secret",
        ),
        "https://shop.example.invalid",
        "en",
        read,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await subject!.informationSitemapResponse(
        new Request("https://shop.example.invalid/ja/information-sitemap.xml"),
        "https://shop.example.invalid",
        "ja",
        read,
      )
    ).status,
  ).toBe(503);
});
