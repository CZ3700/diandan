import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  SUPPORTED_LOCALES,
  storefrontSeoEntitySchema,
  type StorefrontSeoResponse,
} from "@fan-support/contracts";
import { sitemapResponse } from "./sitemap";
const version = "a".repeat(64);
const entity = storefrontSeoEntitySchema.parse({
  schemaVersion: 1,
  locator: { kind: "GIFT", handle: "gift" },
  publication: {
    id: "a1000000-0000-4000-8000-000000000001",
    revisionId: "a2000000-0000-4000-8000-000000000001",
    manifestHash: version,
    publishedAt: "2026-09-07T00:00:00Z",
  },
  locales: SUPPORTED_LOCALES.filter((locale) => locale !== "th").map(
    (locale, index) => ({
      locale,
      translationRevision: `a3000000-0000-4000-8000-00000000000${index}`,
      lastModified: "2026-09-07T00:00:00Z",
    }),
  ),
});
test("global sitemap enumerates every bounded catalog page without hydrating entities", async () => {
  const read = vi.fn(
    async (command) =>
      ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_CATALOG",
        catalogVersion: version,
        shards: [{ cursor: command.cursor ? "second" : "first", itemCount: 1 }],
        pageInfo: {
          hasNextPage: !command.cursor,
          endCursor: command.cursor ? null : "continuation",
        },
      }) as StorefrontSeoResponse,
  );
  const response = await sitemapResponse(
    new Request("https://store.test/sitemap.xml"),
    "https://canonical.test",
    read,
  );
  const xml = await response.text();
  expect(response.status).toBe(200);
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    read.mock.calls.every(([command]) => command.operation === "CATALOG"),
  ).toBe(true);
  expect(xml.match(/<sitemap>/gu)).toHaveLength(14);
  expect(xml).toContain(
    "https://canonical.test/zh-CN/sitemap.xml?cursor=second",
  );
  expect(xml).not.toContain("store.test");
});
test("shards use publication lastmod and remove a failed locale in every reciprocal cluster", async () => {
  const read = vi.fn(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_INDEX",
        catalogVersion: version,
        items: [entity],
        pageInfo: { hasNextPage: false, endCursor: null },
      }) as StorefrontSeoResponse,
  );
  const en = await sitemapResponse(
    new Request("https://store.test/en/sitemap.xml?cursor=first"),
    "https://store.test",
    read,
    "en",
  );
  const xml = await en.text();
  expect(xml).toContain("<lastmod>2026-09-07T00:00:00Z</lastmod>");
  expect(xml).toContain(
    'hreflang="x-default" href="https://store.test/en/gifts/gift"',
  );
  expect(xml).not.toContain('hreflang="th"');
  const th = await sitemapResponse(
    new Request("https://store.test/th/sitemap.xml?cursor=first"),
    "https://store.test",
    read,
    "th",
  );
  expect(await th.text()).not.toContain("<url>");
  const cached = await sitemapResponse(
    new Request("https://store.test/en/sitemap.xml?cursor=first", {
      headers: { "if-none-match": en.headers.get("etag")! },
    }),
    "https://store.test",
    read,
    "en",
  );
  expect(cached.status).toBe(304);
  expect(read).toHaveBeenCalledTimes(3);
  expect(cached.headers.get("cache-control")).toBe(
    "public, max-age=0, s-maxage=0, must-revalidate",
  );
});
test("bad/duplicate/private query, unavailable source, repeated cursor and version race fail closed", async () => {
  const failure = vi.fn(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      }) as StorefrontSeoResponse,
  );
  for (const suffix of [
    "?token=PRIVATE",
    "?cursor=a&cursor=b",
    "?cursor=<script>",
  ]) {
    const response = await sitemapResponse(
      new Request(`https://store.test/en/sitemap.xml${suffix}`),
      "https://store.test",
      failure,
      "en",
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("PRIVATE");
  }
  expect(failure).not.toHaveBeenCalled();
  expect(
    (
      await sitemapResponse(
        new Request("https://store.test/sitemap.xml"),
        "https://store.test",
        failure,
      )
    ).status,
  ).toBe(503);
  const repeated = vi.fn(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_CATALOG",
        catalogVersion: version,
        shards: [{ cursor: "one", itemCount: 1 }],
        pageInfo: { hasNextPage: true, endCursor: "again" },
      }) as StorefrontSeoResponse,
  );
  expect(
    (
      await sitemapResponse(
        new Request("https://store.test/sitemap.xml"),
        "https://store.test",
        repeated,
      )
    ).status,
  ).toBe(503);
});
test("credentials bypass both shared storage and conditional 304", async () => {
  const read = vi.fn(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_CATALOG",
        catalogVersion: version,
        shards: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      }) as StorefrontSeoResponse,
  );
  const response = await sitemapResponse(
    new Request("https://store.test/sitemap.xml", {
      headers: { cookie: "session=PRIVATE", "if-none-match": "*" },
    }),
    "https://store.test",
    read,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("etag")).toBe(false);
});
test("an empty continuation cannot keep a sitemap traversal alive", async () => {
  const read = vi.fn(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_CATALOG",
        catalogVersion: version,
        shards: [],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      }) as StorefrontSeoResponse,
  );
  const response = await sitemapResponse(
    new Request("https://store.test/sitemap.xml"),
    "https://store.test",
    read,
  );
  expect(response.status).toBe(503);
  expect(read).toHaveBeenCalledTimes(1);
});
