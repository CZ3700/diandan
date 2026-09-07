import { expect, test, vi } from "vitest";
import { directoryFixturePage } from "../storefront/directory-fixture.js";
import {
  publishedContentResponseSchema,
  type LocaleContext,
} from "@fan-support/contracts";
vi.mock("server-only", () => ({}));
test("rejects a remote redirect and never forwards viewer credentials to the content API", async () => {
  const loaded = await import("./public-catalog.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.invalid" },
      }),
  );
  const result = await loaded.fetchPublicCatalog(
    "http://localhost:3002",
    "/api/v1/idols",
    new URLSearchParams({ locale: "en" }),
    "directory",
    fetcher,
  );
  expect(result.outcome).toBe("FAILURE");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
});
test("validates the response schema before exposing it to pages", async () => {
  const loaded = await import("./public-catalog.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const result = await loaded.fetchPublicCatalog(
    "http://localhost:3002",
    "/api/v1/idols",
    new URLSearchParams({ locale: "en" }),
    "directory",
    async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        privateAddress: "not-public",
      }),
  );
  expect(result).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});

const enContext: LocaleContext = {
  schemaVersion: 1,
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
};
const jaContext: LocaleContext = {
  schemaVersion: 1,
  requestedLocale: "ja",
  resolvedLocale: "ja",
  fallbackUsed: false,
};
function published(context: LocaleContext = enContext) {
  const directory = directoryFixturePage([1]);
  if (directory.outcome !== "SUCCESS") throw new Error("fixture");
  const view = { ...directory.items[0]!, localeContext: context };
  const response = publishedContentResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLISHED_CONTENT",
    publication: {
      id: view.id,
      revisionId: view.id,
      manifestHash: "a".repeat(64),
      publishedAt: "2026-09-06T00:00:00Z",
    },
    content: { kind: "IDOL", view, aliases: [] },
  });
  if (response.outcome !== "SUCCESS" || response.content.kind !== "IDOL")
    throw new Error("fixture");
  return { ...response, content: response.content };
}
test("directory validates every item against the explicit query locale without fallback", async () => {
  const { fetchPublicCatalog } = await import("./public-catalog.js");
  const page = directoryFixturePage([1, 2]);
  if (page.outcome !== "SUCCESS") throw new Error("fixture");
  const read = () =>
    fetchPublicCatalog(
      "http://localhost:3002",
      "/api/v1/idols",
      new URLSearchParams({ locale: "en" }),
      "directory",
      async () => Response.json(page),
    );
  expect((await read()).outcome).toBe("SUCCESS");
  page.items[1]!.localeContext = jaContext;
  expect(await read()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  page.items[1]!.localeContext = {
    ...jaContext,
    resolvedLocale: "en",
    fallbackUsed: true,
    translationRevision: "approved-english-revision",
  };
  expect(await read()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
test("content requires requested locale and explicit translation provenance for English fallback", async () => {
  const { fetchPublicCatalog } = await import("./public-catalog.js");
  const response = published();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
  const read = () =>
    fetchPublicCatalog(
      "http://localhost:3002",
      "/api/v1/idols/fictional-1",
      new URLSearchParams({ locale: "ja" }),
      "content",
      fetcher,
    );
  expect(await read()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  response.content.view.localeContext = jaContext;
  expect((await read()).outcome).toBe("SUCCESS");
  response.content.view.localeContext = {
    ...jaContext,
    resolvedLocale: "en",
    fallbackUsed: true,
  };
  expect(await read()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  response.content.view.localeContext = {
    ...response.content.view.localeContext,
    translationRevision: "approved-english-revision",
  };
  expect((await read()).outcome).toBe("SUCCESS");
  expect(fetcher).toHaveBeenCalledTimes(4);
});
test("homepage and each hydrated slot are bound to the requested locale", async () => {
  const { fetchPublicCatalog } = await import("./public-catalog.js");
  const idol = published();
  const slot = {
    schemaVersion: 1,
    slotKey: "hero",
    kind: "HERO_IDOL",
    idolId: idol.content.view.id,
    label: "Featured artist",
    sortOrder: 0,
  };
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_HOMEPAGE",
    homepage: {
      ...idol,
      content: {
        kind: "HOMEPAGE",
        view: {
          schemaVersion: 1,
          localeContext: enContext,
          heroTitle: "Home",
          heroSubtitle: "Fictional introduction",
          ctaLabel: "Explore",
          heroDesktop: idol.content.view.heroDesktop,
          heroMobile: idol.content.view.heroMobile,
          slots: [slot],
          seoTitle: "Home",
          seoDescription: "Fictional homepage",
        },
      },
    },
    slots: [
      {
        slotKey: "hero",
        kind: "HERO_IDOL",
        idolId: idol.content.view.id,
        status: "AVAILABLE",
        content: idol,
      },
    ],
  };
  const read = () =>
    fetchPublicCatalog(
      "http://localhost:3002",
      "/api/v1/storefront-homepage",
      new URLSearchParams({ locale: "ja" }),
      "homepage",
      async () => Response.json(response),
    );
  expect(await read()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  response.homepage.content.view.localeContext = jaContext;
  response.slots[0]!.content.content.view.localeContext = jaContext;
  expect((await read()).outcome).toBe("SUCCESS");
  response.slots[0]!.content.content.view.localeContext = {
    ...jaContext,
    resolvedLocale: "en",
    fallbackUsed: true,
  };
  expect(await read()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});
test("HTTP status must agree with the success or failure envelope", async () => {
  const { fetchPublicCatalog } = await import("./public-catalog.js");
  for (const [body, status] of [
    [published(), 201],
    [published(), 503],
    [{ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" }, 200],
    [{ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" }, 503],
    [{ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" }, 404],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(body, { status }),
    );
    expect(
      await fetchPublicCatalog(
        "http://localhost:3002",
        "/api/v1/idols/fictional-1",
        new URLSearchParams({ locale: "en" }),
        "content",
        fetcher,
      ),
    ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledOnce();
  }
});
test("invalid or duplicate presentation locale never makes an upstream call", async () => {
  const { fetchPublicCatalog } = await import("./public-catalog.js");
  const fetcher = vi.fn<typeof fetch>();
  for (const query of ["", "locale=en-XA", "locale=EN", "locale=en&locale=ja"])
    expect(
      await fetchPublicCatalog(
        "http://localhost:3002",
        "/api/v1/idols",
        new URLSearchParams(query),
        "directory",
        fetcher,
      ),
    ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  expect(fetcher).not.toHaveBeenCalled();
});
