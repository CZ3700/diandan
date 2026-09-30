import {
  giftDiscoveryQuerySchema,
  slugSchema,
  type GiftDiscoveryQuery,
  type SupportedLocale,
} from "@fan-support/contracts";
import { queryString, storefrontHref } from "./navigation";

/** A gift entry chooses a new product; a variant belongs only to its original gift. */
export function giftDetailHref(
  locale: SupportedLocale,
  handle: string,
  contextQuery: string,
): string {
  const query = new URLSearchParams(contextQuery);
  query.delete("variant");
  return storefrontHref(
    locale,
    `/gifts/${slugSchema.parse(handle)}`,
    query.toString(),
  );
}

type SearchValues = Readonly<Record<string, string | string[] | undefined>>;

export type PreparedGiftQuery =
  | Readonly<{
      valid: true;
      query: GiftDiscoveryQuery;
      apiQuery: string;
      contextQuery: string;
    }>
  | Readonly<{
      valid: false;
      reason: "CONTEXT_REQUIRED" | "INVALID_QUERY";
      contextQuery: string;
    }>;

export type GiftFilters = Readonly<
  Pick<
    GiftDiscoveryQuery,
    | "sort"
    | "category"
    | "kind"
    | "priceMinMinor"
    | "priceMaxMinor"
    | "availability"
  >
>;

const fields = [
  "market",
  "currency",
  "idol",
  "page",
  "pageSize",
  "sort",
  "category",
  "kind",
  "priceMinMinor",
  "priceMaxMinor",
  "availability",
] as const;
const numericFields = new Set<string>([
  "page",
  "pageSize",
  "priceMinMinor",
  "priceMaxMinor",
]);

function serializeQuery(query: GiftDiscoveryQuery): URLSearchParams {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "schemaVersion" && value !== undefined)
      values.set(key === "idolId" ? "idol" : key, String(value));
  }
  return values;
}

/** Parse only directory-owned fields; unrelated navigation context is retained in links. */
export function prepareGiftQuery(
  locale: SupportedLocale,
  values: SearchValues,
): PreparedGiftQuery {
  const contextQuery = queryString(values);
  const invalid = {
    valid: false,
    reason: "INVALID_QUERY",
    contextQuery,
  } as const;
  const input: Record<string, unknown> = { schemaVersion: 1, locale };
  for (const key of fields) {
    const value = values[key];
    // Older filter forms wrote an unchosen kind or category as an empty value.
    if (
      value === undefined ||
      ((key === "category" || key === "kind") && value === "")
    )
      continue;
    if (typeof value !== "string") return invalid;
    if (numericFields.has(key)) {
      if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) return invalid;
      const number = Number(value);
      if (!Number.isSafeInteger(number)) return invalid;
      input[key] = number;
    } else input[key === "idol" ? "idolId" : key] = value;
  }
  if (values["market"] === undefined || values["currency"] === undefined)
    return { valid: false, reason: "CONTEXT_REQUIRED", contextQuery };
  const parsed = giftDiscoveryQuerySchema.safeParse(input);
  if (!parsed.success) return invalid;
  return {
    valid: true,
    query: parsed.data,
    apiQuery: serializeQuery(parsed.data).toString(),
    contextQuery,
  };
}

/**
 * EXPLICIT: the fan chose this market, so links keep it. IMPLICIT: the sole published market
 * (ADR-017 addendum) priced the page, so links leave it out and stay canonical.
 */
export type GiftScopeInUrl = "EXPLICIT" | "IMPLICIT";

function directoryHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  scope: GiftScopeInUrl,
): string {
  const context = new URLSearchParams(contextQuery);
  for (const field of fields) context.delete(field);
  for (const [key, value] of serializeQuery(query)) {
    if (key === "locale") continue;
    if (scope === "IMPLICIT" && (key === "market" || key === "currency"))
      continue;
    context.set(key, value);
  }
  return storefrontHref(query.locale, basePath, context.toString());
}

export function giftPageHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  page: number,
  scope: GiftScopeInUrl = "EXPLICIT",
): string {
  return directoryHref(
    giftDiscoveryQuerySchema.parse({ ...query, page }),
    basePath,
    contextQuery,
    scope,
  );
}

export function giftFilterHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  filters: GiftFilters,
  scope: GiftScopeInUrl = "EXPLICIT",
): string {
  return directoryHref(
    giftDiscoveryQuerySchema.parse({
      ...query,
      ...filters,
      category: filters.category,
      kind: filters.kind,
      priceMinMinor: filters.priceMinMinor,
      priceMaxMinor: filters.priceMaxMinor,
      page: 1,
    }),
    basePath,
    contextQuery,
    scope,
  );
}

export function giftResetHref(
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
  scope: GiftScopeInUrl = "EXPLICIT",
): string {
  return giftFilterHref(
    query,
    basePath,
    contextQuery,
    { sort: "RECOMMENDED", availability: "ALL" },
    scope,
  );
}
