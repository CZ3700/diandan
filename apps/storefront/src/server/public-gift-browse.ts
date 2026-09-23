import "server-only";
import {
  DEFAULT_LOCALE,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
  type GiftBrowseResponse,
  type ContentLocaleContext,
  type SupportedLocale,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CATALOG_UNAVAILABLE",
} as const;

function matchesLocale(context: ContentLocaleContext, locale: SupportedLocale) {
  if (context.schemaVersion === 2)
    return (
      context.requestedLocale === locale &&
      context.resolvedLocale === context.sourceLocale &&
      context.fallbackUsed === (locale !== context.sourceLocale)
    );
  return (
    context.requestedLocale === locale &&
    (context.fallbackUsed
      ? context.resolvedLocale === DEFAULT_LOCALE &&
        Boolean(context.translationRevision?.trim())
      : context.resolvedLocale === locale)
  );
}

/** Published content only: this read never chooses a market or restores a cart. */
export async function fetchGiftBrowse(
  origin: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<GiftBrowseResponse> {
  const parsed = giftBrowseQuerySchema.safeParse(input);
  if (!parsed.success)
    return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
  const command = parsed.data;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(command))
    if (key !== "schemaVersion" && value !== undefined)
      query.set(key === "idolId" ? "idol" : key, String(value));
  try {
    const url = new URL("/api/v1/gift-browse", origin);
    url.search = query.toString();
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const result = giftBrowseResponseSchema.safeParse(await response.json());
    if (!result.success) return unavailable;
    const data = result.data;
    if (data.outcome === "FAILURE") {
      const status =
        data.code === "CATALOG_UNAVAILABLE"
          ? 503
          : data.code === "ANCHOR_NOT_FOUND"
            ? 404
            : data.code === "CATALOG_CHANGED"
              ? 409
              : 400;
      return response.status === status ? data : unavailable;
    }
    if (
      response.status !== 200 ||
      data.pageInfo.page !== command.page ||
      data.pageInfo.pageSize !== command.pageSize ||
      data.items.length !==
        Math.max(
          0,
          Math.min(
            command.pageSize,
            data.pageInfo.totalItems - (command.page - 1) * command.pageSize,
          ),
        ) ||
      new Set(data.items.map((item) => item.id.toLowerCase())).size !==
        data.items.length ||
      data.items.some(
        (item) =>
          !matchesLocale(item.localeContext, command.locale) ||
          (command.category !== undefined &&
            item.category !== command.category),
      )
    )
      return unavailable;
    return data;
  } catch {
    return unavailable;
  }
}

export async function readGiftBrowse(
  input: unknown,
): Promise<GiftBrowseResponse> {
  try {
    return await fetchGiftBrowse(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
      input,
    );
  } catch {
    return unavailable;
  }
}
