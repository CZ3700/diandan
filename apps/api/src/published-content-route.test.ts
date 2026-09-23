import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerCatalogDirectoryRoute } from "./catalog-directory-route.js";
import {
  registerPublishedContentRoute,
  type PublishedContentRouteDependencies,
} from "./published-content-route.js";

const id = "abcdefab-0000-4000-8000-000000000001";
const media = {
  schemaVersion: 1,
  kind: "INFORMATIVE",
  url: "https://media.example.invalid/image.webp",
  alt: "Fictional image",
  width: 400,
  height: 500,
  focalPoint: { x: 0.5, y: 0.5 },
};
const publication = {
  id,
  revisionId: id,
  manifestHash: "a".repeat(64),
  publishedAt: "2026-09-06T00:00:00.123456Z",
};
const locations = [
  {
    path: "/idols/fictional-idol",
    locator: { kind: "IDOL", handle: "fictional-idol" },
  },
  {
    path: "/gifts/fictional-gift",
    locator: { kind: "GIFT", handle: "fictional-gift" },
  },
  { path: "/homepage", locator: { kind: "HOMEPAGE" } },
  {
    path: "/policies/privacy",
    locator: { kind: "POLICY", policyKey: "privacy" },
  },
  {
    path: `/media/${id}`,
    locator: { kind: "MEDIA_METADATA", mediaAssetId: id },
  },
] as const;
function responseFor(kind: string, locale: SupportedLocale = "en") {
  const localeContext = {
    schemaVersion: 1,
    requestedLocale: locale,
    resolvedLocale: locale,
    fallbackUsed: false,
    translationRevision: id,
  };
  const common = { schemaVersion: 1, localeContext };
  let content: unknown;
  switch (kind) {
    case "IDOL":
      content = {
        kind,
        aliases: [{ id: "stage-name", locale: null, text: "Fictional alias" }],
        view: {
          ...common,
          id,
          handle: "fictional-idol",
          status: "active",
          acceptingGifts: true,
          displayName: "Fictional idol",
          shortBio: "Short biography",
          fullBio: "<p>Full biography.</p>",
          seoTitle: "Fictional idol",
          seoDescription: "Fictional description",
          themeAccent: "#8899aa",
          heroTextTone: "light",
          portrait: media,
          heroDesktop: media,
          heroMobile: media,
          gallery: [],
        },
      };
      break;
    case "GIFT":
      content = {
        kind,
        view: {
          ...common,
          id,
          handle: "fictional-gift",
          status: "active",
          title: "Fictional gift",
          subtitle: "A small gift",
          shortDescription: "Short description",
          description: "Legacy description",
          fulfillmentDescription: "Prepared for the selected idol",
          category: "OTHER",
          contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
          deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
          shippingMode: "internal_to_idol",
          primaryMedia: media,
          gallery: [],
          variants: [
            {
              schemaVersion: 1,
              id,
              label: "Standard",
              status: "active",
              inventoryPolicy: "PROCURE_ON_DEMAND",
            },
          ],
          seoTitle: "Fictional gift",
          seoDescription: "Fictional description",
        },
        details: {
          format: "BLOCKS",
          blocks: [
            { id: "intro", kind: "PARAGRAPH", text: "Reviewed detail" },
            { id: "photo", kind: "MEDIA", media, caption: "A detail photo" },
          ],
        },
      };
      break;
    case "HOMEPAGE":
      content = {
        kind,
        view: {
          ...common,
          heroTitle: "Fictional homepage",
          heroSubtitle: "Introduction",
          ctaLabel: "Explore",
          heroDesktop: media,
          heroMobile: media,
          slots: [
            {
              schemaVersion: 1,
              slotKey: "hero",
              label: "Fictional idol",
              sortOrder: 0,
              kind: "HERO_IDOL",
              idolId: id,
            },
          ],
          seoTitle: "Fictional homepage",
          seoDescription: "Fictional description",
        },
      };
      break;
    case "POLICY":
      content = {
        kind,
        view: {
          ...common,
          policyKey: "privacy",
          kind: "PRIVACY",
          title: "Privacy",
          summary: "Fictional summary",
          body: "<p>Fictional policy.</p>",
          effectiveAt: "2026-09-06T00:00:00Z",
        },
      };
      break;
    default:
      content = { kind: "MEDIA_METADATA", localeContext, view: media };
  }
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLISHED_CONTENT",
    publication,
    content,
  };
}
function setup() {
  const logs: string[] = [];
  const app = Fastify({ logger: false });
  registerFastifyObservability(app, {
    service: "api",
    logger: createStructuredLogger({
      service: "api",
      write: (line) => {
        logs.push(line);
      },
    }),
  });
  const execute = vi.fn<(input: unknown) => Promise<unknown>>(async () =>
    responseFor("POLICY"),
  );
  registerPublishedContentRoute(app, {
    useCases: {
      execute:
        execute as PublishedContentRouteDependencies["useCases"]["execute"],
    },
  });
  return { app, execute, logs };
}
function privacy(headers: Record<string, unknown>, revalidated = false) {
  expect(headers["cache-control"]).toBe(
    revalidated ? "public, max-age=0, s-maxage=0, must-revalidate" : "no-store",
  );
  if (revalidated) expect(headers["etag"]).toMatch(/^W\/"[a-f0-9]{64}"$/u);
  else expect(headers["etag"]).toBeUndefined();
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["set-cookie"]).toBeUndefined();
  expect(String(headers["vary"] ?? "").toLowerCase()).not.toContain(
    "accept-language",
  );
}

test("maps all five anonymous GET locators with explicit seven-language context", async () => {
  const { app, execute } = setup();
  try {
    for (const { path, locator } of locations)
      for (const locale of SUPPORTED_LOCALES) {
        execute.mockResolvedValueOnce(responseFor(locator.kind, locale));
        const response = await app.inject({
          method: "GET",
          url: `/api/v1${path}?locale=${locale}`,
        });
        expect(response.statusCode).toBe(200);
        privacy(response.headers, true);
        expect(execute).toHaveBeenLastCalledWith({
          schemaVersion: 1,
          locator,
          locale,
        });
        expect(response.json()).toMatchObject({
          kind: "PUBLISHED_CONTENT",
          publication,
        });
      }
  } finally {
    await app.close();
  }
});

test("every content kind rechecks current proof before 304 and keeps credentials private", async () => {
  const { app, execute } = setup();
  try {
    for (const { path, locator } of locations) {
      execute.mockResolvedValue(responseFor(locator.kind));
      const url = `/api/v1${path}?locale=en`;
      const first = await app.inject({ url });
      const etag = String(first.headers.etag);
      expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
      const before = execute.mock.calls.length;
      const same = await app.inject({
        url,
        headers: { "if-none-match": etag },
      });
      expect(same.statusCode).toBe(304);
      expect(same.body).toBe("");
      expect(execute.mock.calls.length).toBe(before + 1);
      privacy(same.headers, true);
      for (const credentials of [
        { cookie: "fixture=public" },
        { authorization: "Bearer fixture-only" },
      ]) {
        const privateReply = await app.inject({
          url,
          headers: { ...credentials, "if-none-match": "*" },
        });
        expect(privateReply.statusCode).toBe(200);
        expect(privateReply.headers["cache-control"]).toBe("private, no-store");
        expect(privateReply.headers.etag).toBeUndefined();
      }
      execute.mockResolvedValue({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
      const revoked = await app.inject({
        url,
        headers: { "if-none-match": etag },
      });
      expect(revoked.statusCode).toBe(503);
      privacy(revoked.headers);
    }
  } finally {
    await app.close();
  }
});

test("accepts schema-validated incident English recovery for every requested non-English locale", async () => {
  const { app, execute } = setup();
  try {
    for (const { path, locator } of locations)
      for (const locale of SUPPORTED_LOCALES.filter(
        (value) => value !== "en",
      )) {
        const result = responseFor(locator.kind);
        const item = result.content as {
          kind: string;
          localeContext?: unknown;
          view: Record<string, unknown>;
        };
        const recovered = {
          schemaVersion: 1,
          requestedLocale: locale,
          resolvedLocale: "en",
          fallbackUsed: true,
          translationRevision: id,
        };
        if (item.kind === "MEDIA_METADATA") item.localeContext = recovered;
        else item.view["localeContext"] = recovered;
        execute.mockResolvedValueOnce(result);
        const response = await app.inject({
          url: `/api/v1${path}?locale=${locale}`,
        });
        expect(response.statusCode).toBe(200);
        privacy(response.headers, true);
        expect(response.json()).toEqual(result);
      }
    const result = responseFor("IDOL", "ja");
    const item = result.content as { view: Record<string, unknown> };
    for (const changed of [
      { requestedLocale: "th", resolvedLocale: "en", fallbackUsed: true },
      { requestedLocale: "ja", resolvedLocale: "th", fallbackUsed: true },
      { requestedLocale: "ja", resolvedLocale: "en", fallbackUsed: false },
      { requestedLocale: "ja", resolvedLocale: "ja", fallbackUsed: true },
    ]) {
      item.view["localeContext"] = {
        schemaVersion: 1,
        translationRevision: id,
        ...changed,
      };
      execute.mockResolvedValueOnce(result);
      const response = await app.inject({
        url: "/api/v1/idols/fictional-idol?locale=ja",
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
    }
  } finally {
    await app.close();
  }
});

test("rejects missing, duplicate, unsupported or extra query authority and malformed locators", async () => {
  const { app, execute } = setup();
  try {
    for (const query of [
      "",
      "?locale=",
      "?locale=EN",
      "?locale=en-XA",
      "?locale=en&locale=en",
      "?locale=ja&locale=en",
      "?locale=en&revisionId=" + id,
      "?locale=en&publicationId=" + id,
      "?locale=en&market=test",
      "?locale=en&token=QUERY_SECRET_CANARY",
      "?locale=en&schemaVersion=1",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/policies/privacy" + query,
        headers: { "accept-language": "en" },
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const path of [
      "/idols/Bad_Handle",
      "/gifts/invalid%2Fhandle",
      "/policies/Bad_Key",
      "/media/not-a-uuid",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1${path}?locale=en`,
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects wrong object or language and fallback instead of returning another published object", async () => {
  const { app, execute } = setup();
  try {
    const policy = responseFor("POLICY");
    const content = policy.content as {
      kind: string;
      view: Record<string, unknown>;
    };
    const wrong = [
      responseFor("IDOL"),
      responseFor("POLICY", "ja"),
      {
        ...policy,
        content: {
          ...content,
          view: { ...content.view, policyKey: "refunds" },
        },
      },
      {
        ...policy,
        content: {
          ...content,
          view: {
            ...content.view,
            localeContext: {
              schemaVersion: 1,
              requestedLocale: "en",
              resolvedLocale: "en",
              fallbackUsed: true,
              translationRevision: id,
            },
          },
        },
      },
    ];
    for (const value of wrong) {
      execute.mockResolvedValueOnce(value);
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/policies/privacy?locale=en",
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
    }
    for (const location of locations.filter((value) =>
      ["IDOL", "GIFT"].includes(value.locator.kind),
    )) {
      const original = responseFor(location.locator.kind);
      const item = original.content as {
        kind: string;
        view: Record<string, unknown>;
      };
      execute.mockResolvedValueOnce({
        ...original,
        content: { ...item, view: { ...item.view, handle: "another-object" } },
      });
      const response = await app.inject({
        method: "GET",
        url: `/api/v1${location.path}?locale=en`,
      });
      expect(response.statusCode).toBe(503);
    }
  } finally {
    await app.close();
  }
});

test("keeps rich gift blocks separate from legacy text and refuses private provider fields", async () => {
  const { app, execute, logs } = setup();
  try {
    const gift = responseFor("GIFT");
    const content = gift.content as {
      kind: string;
      view: Record<string, unknown>;
      details: unknown;
    };
    execute.mockResolvedValueOnce({
      ...gift,
      content: {
        ...content,
        details: { format: "LEGACY_TEXT", text: content.view["description"] },
      },
    });
    const legacy = await app.inject({
      method: "GET",
      url: "/api/v1/gifts/fictional-gift?locale=en",
    });
    expect(legacy.statusCode).toBe(200);
    for (const wrong of [
      {
        ...gift,
        content: {
          ...content,
          details: { format: "LEGACY_TEXT", text: "Other description" },
        },
      },
      { ...gift, content: { ...content, proof: "PRIVATE_REVIEW_CANARY" } },
      {
        ...gift,
        content: {
          ...content,
          view: {
            ...content.view,
            primaryMedia: { ...media, objectKey: "PRIVATE_STORAGE_CANARY" },
          },
        },
      },
      { ...gift, publication: { ...publication, reviewerId: id } },
    ]) {
      execute.mockResolvedValueOnce(wrong);
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/gifts/fictional-gift?locale=en",
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
      expect(response.body).not.toMatch(/PRIVATE_/u);
    }
    execute.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_EXCEPTION"));
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/policies/privacy?locale=en",
    });
    expect(response.statusCode).toBe(503);
    expect(logs.join("\n") + response.body).not.toMatch(/PRIVATE_/u);
  } finally {
    await app.close();
  }
});

test("uses safe public errors, protects unknown methods and coexists with directory GET", async () => {
  const { app, execute } = setup();
  const read = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "CATALOG_UNAVAILABLE" as const,
  }));
  registerCatalogDirectoryRoute(app, {
    readIdols: read,
    readGifts: read,
    browseGifts: read,
  });
  try {
    for (const [code, expected] of Object.entries({
      INVALID_QUERY: 400,
      NOT_FOUND: 404,
      CONTENT_UNAVAILABLE: 503,
    })) {
      execute.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/policies/privacy?locale=en",
      });
      expect(response.statusCode).toBe(expected);
      privacy(response.headers);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
    }
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/policies/privacy?locale=en",
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    privacy(missing.headers);
    const directory = await app.inject({
      method: "GET",
      url: "/api/v1/idols?locale=en",
    });
    expect(directory.statusCode).toBe(503);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
