import "server-only";
import {
  DEFAULT_LOCALE,
  supportedLocaleSchema,
  idolDirectoryResponseSchema,
  publishedContentResponseSchema,
  storefrontHomepageResponseSchema,
  type LocaleContext,
  type SupportedLocale,
  type IdolDirectoryResponse,
  type PublishedContentResponse,
  type StorefrontHomepageResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

type Kind = "directory" | "content" | "homepage";
type Result = {
  directory: IdolDirectoryResponse;
  content: PublishedContentResponse;
  homepage: StorefrontHomepageResponse;
};
const schemas = {
  directory: idolDirectoryResponseSchema,
  content: publishedContentResponseSchema,
  homepage: storefrontHomepageResponseSchema,
};
const failure = (kind: Kind) => ({
  schemaVersion: 1 as const,
  outcome: "FAILURE" as const,
  code:
    kind === "directory"
      ? ("CATALOG_UNAVAILABLE" as const)
      : ("CONTENT_UNAVAILABLE" as const),
});

function expectedStatus(data: Result[Kind]): number {
  if (data.outcome === "SUCCESS") return 200;
  switch (data.code) {
    case "INVALID_QUERY":
    case "INVALID_CURSOR":
      return 400;
    case "NOT_FOUND":
    case "ANCHOR_NOT_FOUND":
      return 404;
    case "CATALOG_CHANGED":
      return 409;
    case "CATALOG_UNAVAILABLE":
    case "CONTENT_UNAVAILABLE":
      return 503;
  }
}
function matchesLocale(
  context: LocaleContext,
  locale: SupportedLocale,
  allowFallback: boolean,
): boolean {
  if (context.requestedLocale !== locale) return false;
  if (!context.fallbackUsed) return context.resolvedLocale === locale;
  return (
    allowFallback &&
    context.resolvedLocale === DEFAULT_LOCALE &&
    typeof context.translationRevision === "string" &&
    context.translationRevision.trim().length > 0
  );
}
function responseMatchesLocale(
  data: Result[Kind],
  locale: SupportedLocale,
): boolean {
  if (data.outcome === "FAILURE") return true;
  if ("items" in data)
    return data.items.every((item) =>
      matchesLocale(item.localeContext, locale, false),
    );
  if (data.kind === "PUBLISHED_CONTENT")
    return matchesLocale(
      data.content.kind === "MEDIA_METADATA"
        ? data.content.localeContext
        : data.content.view.localeContext,
      locale,
      true,
    );
  return (
    matchesLocale(data.homepage.content.view.localeContext, locale, true) &&
    data.slots.every(
      (slot) =>
        slot.status === "UNAVAILABLE" ||
        matchesLocale(slot.content.content.view.localeContext, locale, true),
    )
  );
}

/** Fixed read paths, no viewer cookies, redirects or unvalidated upstream values. */
export async function fetchPublicCatalog<K extends Kind>(
  origin: string,
  path: string,
  query: URLSearchParams,
  kind: K,
  fetcher: typeof fetch = fetch,
): Promise<Result[K]> {
  try {
    if (!path.startsWith("/api/v1/") || /[?#\\]/u.test(path))
      return failure(kind) as Result[K];
    const locale = supportedLocaleSchema.safeParse(query.get("locale"));
    if (!locale.success || query.getAll("locale").length !== 1)
      return failure(kind) as Result[K];
    const url = new URL(path, origin);
    url.search = query.toString();
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400)
      return failure(kind) as Result[K];
    const data = schemas[kind].safeParse(await response.json());
    if (!data.success) return failure(kind) as Result[K];
    if (
      response.status !== expectedStatus(data.data) ||
      !responseMatchesLocale(data.data, locale.data)
    )
      return failure(kind) as Result[K];
    return data.data as Result[K];
  } catch {
    return failure(kind) as Result[K];
  }
}
export async function readPublicCatalog<K extends Kind>(
  path: string,
  query: URLSearchParams,
  kind: K,
): Promise<Result[K]> {
  try {
    const config = resolveInternalApiRuntimeConfig({
      environment: process.env,
    });
    return await fetchPublicCatalog(config.origin, path, query, kind);
  } catch {
    return failure(kind) as Result[K];
  }
}
