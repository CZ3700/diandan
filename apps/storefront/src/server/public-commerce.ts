import "server-only";
import {
  DEFAULT_LOCALE,
  giftDirectoryResponseSchema,
  giftDiscoveryQuerySchema,
  publishedGiftCommerceReadCommandSchema,
  publishedGiftCommerceResponseSchema,
  storefrontContextResponseSchema,
  storefrontGiftReadCommandSchema,
  storefrontGiftResponseSchema,
  type GiftDirectoryResponse,
  type ContentLocaleContext,
  type PublishedGiftCommerceResponse,
  type StorefrontContextResponse,
  type StorefrontGiftReadCommand,
  type StorefrontGiftResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

type Result = {
  context: StorefrontContextResponse;
  gift: StorefrontGiftResponse;
  published: PublishedGiftCommerceResponse;
  directory: GiftDirectoryResponse;
};
type Kind = keyof Result;
const schemas = {
  context: storefrontContextResponseSchema,
  gift: storefrontGiftResponseSchema,
  published: publishedGiftCommerceResponseSchema,
  directory: giftDirectoryResponseSchema,
};
const unavailable = <K extends Kind>(kind: K) =>
  ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code:
      kind === "context"
        ? "COMMERCE_UNAVAILABLE"
        : kind === "directory"
          ? "CATALOG_UNAVAILABLE"
          : "CONTENT_UNAVAILABLE",
  }) as Result[K];
const invalid = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "INVALID_QUERY",
} as const;
function status(data: Result[Kind]): number {
  if (data.outcome === "SUCCESS") return 200;
  switch (data.code) {
    case "INVALID_QUERY":
    case "INVALID_CURSOR":
      return 400;
    case "NOT_FOUND":
    case "ANCHOR_NOT_FOUND":
      return 404;
    case "CATALOG_CHANGED":
    case "MARKET_UNAVAILABLE":
      return 409;
    default:
      return 503;
  }
}
function localeMatches(
  context: ContentLocaleContext,
  locale: SupportedLocale,
  fallback: boolean,
) {
  if (context.schemaVersion === 2)
    return (
      context.requestedLocale === locale &&
      context.resolvedLocale === context.sourceLocale &&
      context.fallbackUsed === (locale !== context.sourceLocale)
    );
  return (
    context.requestedLocale === locale &&
    (context.fallbackUsed
      ? fallback &&
        context.resolvedLocale === DEFAULT_LOCALE &&
        typeof context.translationRevision === "string" &&
        context.translationRevision.trim().length > 0
      : context.resolvedLocale === locale)
  );
}
async function request<K extends Kind>(
  origin: string,
  path: string,
  query: URLSearchParams,
  kind: K,
  matches: (data: Result[K]) => boolean,
  fetcher: typeof fetch,
): Promise<Result[K]> {
  try {
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
      return unavailable(kind);
    const parsed = schemas[kind].safeParse(await response.json());
    if (
      !parsed.success ||
      response.status !== status(parsed.data) ||
      !matches(parsed.data as Result[K])
    )
      return unavailable(kind);
    return parsed.data as Result[K];
  } catch {
    return unavailable(kind);
  }
}
async function configured<K extends Kind>(
  kind: K,
  work: (origin: string) => Promise<Result[K]>,
): Promise<Result[K]> {
  try {
    return await work(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
    );
  } catch {
    return unavailable(kind);
  }
}
export function fetchStorefrontContext(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<StorefrontContextResponse> {
  return request(
    origin,
    "/api/v1/storefront-context",
    new URLSearchParams(),
    "context",
    () => true,
    fetcher,
  );
}
export function readStorefrontContext(): Promise<StorefrontContextResponse> {
  return configured("context", (origin) => fetchStorefrontContext(origin));
}
export function fetchStorefrontGift(
  origin: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<StorefrontGiftResponse> {
  const parsed = storefrontGiftReadCommandSchema.safeParse(
    input !== null && typeof input === "object"
      ? { ...input, schemaVersion: 1 }
      : input,
  );
  if (!parsed.success) return Promise.resolve(invalid);
  const command = parsed.data;
  const query = new URLSearchParams({
    locale: command.locale,
    market: command.market,
    currency: command.currency,
  });
  if (command.idolId !== undefined) query.set("idol", command.idolId);
  return request(
    origin,
    `/api/v1/storefront-gifts/${encodeURIComponent(command.handle)}`,
    query,
    "gift",
    (data) => {
      if (data.outcome === "FAILURE") return true;
      if (
        data.content.view.handle !== command.handle ||
        data.market !== command.market ||
        data.currency !== command.currency ||
        !localeMatches(data.content.view.localeContext, command.locale, true)
      )
        return false;
      if (data.recipient.kind === "NONE") return command.idolId === undefined;
      if (command.idolId === undefined) return false;
      return data.recipient.kind === "UNAVAILABLE"
        ? data.recipient.idolId.toLowerCase() === command.idolId.toLowerCase()
        : data.recipient.idol.id.toLowerCase() ===
            command.idolId.toLowerCase() &&
            localeMatches(
              data.recipient.idol.localeContext,
              command.locale,
              true,
            );
    },
    fetcher,
  );
}
export function readStorefrontGift(
  command: Omit<StorefrontGiftReadCommand, "schemaVersion">,
): Promise<StorefrontGiftResponse> {
  return configured("gift", (origin) => fetchStorefrontGift(origin, command));
}
export function fetchPublishedGiftCommerce(
  origin: string,
  locale: SupportedLocale,
  handle: string,
  fetcher: typeof fetch = fetch,
): Promise<PublishedGiftCommerceResponse> {
  const parsed = publishedGiftCommerceReadCommandSchema.safeParse({
    schemaVersion: 1,
    locale,
    locator: { kind: "GIFT", handle },
  });
  if (!parsed.success) return Promise.resolve(invalid);
  return request(
    origin,
    `/api/v1/gift-content/${encodeURIComponent(parsed.data.locator.handle)}`,
    new URLSearchParams({ locale }),
    "published",
    (data) =>
      data.outcome === "FAILURE" ||
      (data.content.view.handle === handle &&
        localeMatches(data.content.view.localeContext, locale, true)),
    fetcher,
  );
}
export function readPublishedGiftCommerce(
  locale: SupportedLocale,
  handle: string,
): Promise<PublishedGiftCommerceResponse> {
  return configured("published", (origin) =>
    fetchPublishedGiftCommerce(origin, locale, handle),
  );
}
function directoryCommand(query: URLSearchParams) {
  const values: Record<string, unknown> = { schemaVersion: 1 };
  const numbers = new Set([
    "page",
    "pageSize",
    "priceMinMinor",
    "priceMaxMinor",
  ]);
  const allowed = new Set([
    "locale",
    "market",
    "currency",
    "idol",
    "page",
    "pageSize",
    "sort",
    "category",
    "priceMinMinor",
    "priceMaxMinor",
    "availability",
  ]);
  for (const [key, value] of query) {
    if (
      !allowed.has(key) ||
      query.getAll(key).length !== 1 ||
      (numbers.has(key) && !/^(?:0|[1-9]\d*)$/u.test(value))
    )
      return undefined;
    values[key === "idol" ? "idolId" : key] = numbers.has(key)
      ? Number(value)
      : value;
  }
  const parsed = giftDiscoveryQuerySchema.safeParse(values);
  return parsed.success ? parsed.data : undefined;
}
export function fetchStorefrontGiftDirectory(
  origin: string,
  query: URLSearchParams,
  fetcher: typeof fetch = fetch,
): Promise<GiftDirectoryResponse> {
  const command = directoryCommand(query);
  if (!command) return Promise.resolve(invalid);
  return request(
    origin,
    "/api/v1/gifts",
    query,
    "directory",
    (data) =>
      data.outcome === "FAILURE" ||
      (data.pageInfo.page === command.page &&
        data.pageInfo.pageSize === command.pageSize &&
        data.items.length ===
          Math.max(
            0,
            Math.min(
              command.pageSize,
              data.pageInfo.totalItems - (command.page - 1) * command.pageSize,
            ),
          ) &&
        new Set(data.items.map((item) => item.gift.id.toLowerCase())).size ===
          data.items.length &&
        data.items.every(
          (item) =>
            item.offer.market === command.market &&
            item.offer.currency === command.currency &&
            localeMatches(item.gift.localeContext, command.locale, false),
        )),
    fetcher,
  );
}
export function readStorefrontGiftDirectory(
  query: URLSearchParams,
): Promise<GiftDirectoryResponse> {
  return configured("directory", (origin) =>
    fetchStorefrontGiftDirectory(origin, query),
  );
}
