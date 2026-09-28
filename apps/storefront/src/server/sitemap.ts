import "server-only";
import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  storefrontSeoCursorSchema,
  storefrontSeoResponseSchema,
  supportedLocaleSchema,
  type StorefrontSeoEntity,
  type StorefrontSeoReadCommand,
  type StorefrontSeoResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  createSeoIdentity,
  seoAlternateUrls,
} from "../storefront/seo-identity";

type Read = (
  command: StorefrontSeoReadCommand,
) => Promise<StorefrontSeoResponse>;
export const escapeSitemapXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const escapeXml = escapeSitemapXml;
const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
const maxEntries = 50_000;
export function sitemapFailure(status: number): Response {
  return new Response("Sitemap unavailable", {
    status,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
const failure = sitemapFailure;
function identity(entity: StorefrontSeoEntity, locale: SupportedLocale) {
  const locator = entity.locator;
  switch (locator.kind) {
    case "HOMEPAGE":
      return createSeoIdentity(locale, "home", undefined, {});
    case "IDOL":
      return createSeoIdentity(locale, "artist", locator.handle, {});
    case "GIFT":
      return createSeoIdentity(locale, "gift", locator.handle, {});
    case "POLICY":
      return createSeoIdentity(locale, "policy", locator.policyKey, {});
  }
}
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header || header.length > 4096) return false;
  if (header.trim() === "*") return true;
  const token = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/gu;
  const tags = header.match(token) ?? [];
  return (
    header.replace(token, "").replaceAll(",", "").trim() === "" &&
    tags.some((tag) => tag.replace(/^W\//u, "") === etag.replace(/^W\//u, ""))
  );
}
export function sitemapXmlResponse(
  request: Request,
  xml: string,
  locale?: SupportedLocale,
): Response {
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024) return failure(503);
  const privateRequest =
    request.headers.has("cookie") || request.headers.has("authorization");
  const headers = new Headers({
    "content-type": "application/xml; charset=utf-8",
    "cache-control": privateRequest
      ? "private, no-store"
      : "public, max-age=0, s-maxage=0, must-revalidate",
    "x-content-type-options": "nosniff",
  });
  if (locale) headers.set("content-language", locale);
  if (!privateRequest) {
    const etag = `W/"${createHash("sha256").update(xml).digest("hex")}"`;
    headers.set("etag", etag);
    if (matchesEtag(request.headers.get("if-none-match"), etag))
      return new Response(null, { status: 304, headers });
  }
  return new Response(xml, { headers });
}
const response = sitemapXmlResponse;

/** All reads are fresh canonical API snapshots; stale/failed traversal is never published as a partial index. */
export async function sitemapResponse(
  request: Request,
  origin: string,
  read: Read,
  locale?: SupportedLocale,
  information?: () => Promise<readonly SupportedLocale[]>,
): Promise<Response> {
  try {
    if (
      locale !== undefined &&
      !supportedLocaleSchema.safeParse(locale).success
    )
      return failure(404);
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((key) => key !== "cursor") ||
      query.getAll("cursor").length > 1 ||
      (!locale && query.size > 0)
    )
      return failure(400);
    const cursor = query.get("cursor");
    if (cursor !== null && !storefrontSeoCursorSchema.safeParse(cursor).success)
      return failure(400);
    if (locale && cursor) {
      const result = storefrontSeoResponseSchema.parse(
        await read({ schemaVersion: 1, operation: "INDEX", cursor }),
      );
      if (result.outcome === "FAILURE")
        return failure(
          result.code === "CATALOG_CHANGED"
            ? 409
            : result.code === "INVALID_CURSOR"
              ? 400
              : 503,
        );
      if (result.kind !== "STOREFRONT_SEO_INDEX") return failure(503);
      if (result.pageInfo.hasNextPage && result.items.length === 0)
        return failure(503);
      const entries = result.items.flatMap((entity) => {
        const translated = entity.locales.find((row) => row.locale === locale);
        if (!translated) return [];
        const page = identity(entity, locale);
        const alternates = seoAlternateUrls(
          origin,
          page,
          entity.locales.map((row) => row.locale),
        );
        return [
          `<url><loc>${escapeXml(new URL(page.canonicalPath, origin).href)}</loc><lastmod>${escapeXml(translated.lastModified)}</lastmod>${Object.entries(
            alternates,
          )
            .map(
              ([language, href]) =>
                `<xhtml:link rel="alternate" hreflang="${language}" href="${escapeXml(href)}"/>`,
            )
            .join("")}</url>`,
        ];
      });
      return response(
        request,
        `${declaration}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>`,
        locale,
      );
    }
    const entries: string[] = [],
      cursors = new Set<string>(),
      shards = new Set<string>();
    let next: string | undefined, version: string | undefined;
    do {
      const result = storefrontSeoResponseSchema.parse(
        await read({
          schemaVersion: 1,
          operation: "CATALOG",
          ...(next ? { cursor: next } : {}),
        }),
      );
      if (result.outcome === "FAILURE")
        return failure(result.code === "CATALOG_CHANGED" ? 409 : 503);
      if (
        result.kind !== "STOREFRONT_SEO_CATALOG" ||
        (version !== undefined && result.catalogVersion !== version)
      )
        return failure(503);
      version = result.catalogVersion;
      if (result.pageInfo.hasNextPage && result.shards.length === 0)
        return failure(503);
      for (const shard of result.shards) {
        if (shards.has(shard.cursor)) return failure(503);
        shards.add(shard.cursor);
        for (const language of locale ? [locale] : SUPPORTED_LOCALES) {
          const url = new URL(`/${language}/sitemap.xml`, origin);
          url.searchParams.set("cursor", shard.cursor);
          entries.push(`<sitemap><loc>${escapeXml(url.href)}</loc></sitemap>`);
          if (entries.length > maxEntries) return failure(503);
        }
      }
      next = result.pageInfo.endCursor ?? undefined;
      if (next) {
        if (cursors.has(next)) return failure(503);
        cursors.add(next);
      }
    } while (next);
    if (information) {
      for (const language of await information()) {
        if (locale && language !== locale) continue;
        const url = new URL(`/${language}/information-sitemap.xml`, origin);
        entries.push(`<sitemap><loc>${escapeXml(url.href)}</loc></sitemap>`);
      }
    }
    return response(
      request,
      `${declaration}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</sitemapindex>`,
      locale,
    );
  } catch {
    return failure(503);
  }
}
