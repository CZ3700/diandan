import {
  giftBrowseQuerySchema,
  type GiftBrowseQuery,
  type GiftDiscoveryQuery,
  type GiftKind,
  type SupportedLocale,
} from "@fan-support/contracts";
import { queryString, storefrontHref } from "./navigation";

type Values = Readonly<Record<string, string | string[] | undefined>>;
const fields = ["page", "pageSize", "category", "kind", "idol"] as const;
/** Every parameter that belongs to one directory view rather than to navigation context. */
const directoryFields = [
  ...fields,
  "sort",
  "priceMinMinor",
  "priceMaxMinor",
  "availability",
  "anchorId",
  "variant",
] as const;

export function prepareGiftBrowse(locale: SupportedLocale, values: Values) {
  const input: Record<string, unknown> = { schemaVersion: 1, locale };
  for (const key of fields) {
    const value = values[key];
    if (
      value === undefined ||
      ((key === "category" || key === "kind") && value === "")
    )
      continue;
    if (typeof value !== "string") return undefined;
    if (key === "page" || key === "pageSize") {
      if (!/^[1-9]\d{0,4}$/u.test(value)) return undefined;
      input[key] = Number(value);
    } else input[key === "idol" ? "idolId" : key] = value;
  }
  const parsed = giftBrowseQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function giftBrowseHref(
  query: GiftBrowseQuery,
  basePath: string,
  contextQuery: string,
  page: number,
  reset = false,
) {
  const values = new URLSearchParams(contextQuery);
  for (const field of fields) values.delete(field);
  values.set("page", String(page));
  values.set("pageSize", String(query.pageSize));
  if (query.idolId) values.set("idol", query.idolId);
  if (query.category && !reset) values.set("category", query.category);
  if (query.kind && !reset) values.set("kind", query.kind);
  return `${storefrontHref(query.locale, basePath, values.toString())}#gifts`;
}

/**
 * A toolbar choice returns to the first page and keeps every other choice. `kind: null`
 * shows all kinds; the recommended order is the address without a sort.
 */
export function giftBrowseChoiceHref(
  query: GiftBrowseQuery,
  basePath: string,
  contextQuery: string,
  choice: Readonly<{
    kind?: GiftKind | null;
    category?: null;
    sort?: GiftDiscoveryQuery["sort"];
  }>,
) {
  const url = new URL(
    giftBrowseHref(query, basePath, contextQuery, 1),
    "https://storefront.invalid",
  );
  if (choice.kind === null) url.searchParams.delete("kind");
  else if (choice.kind) url.searchParams.set("kind", choice.kind);
  if (choice.category === null) url.searchParams.delete("category");
  if (choice.sort === "RECOMMENDED") url.searchParams.delete("sort");
  else if (choice.sort) url.searchParams.set("sort", choice.sort);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A kind entry opens the first page of that kind, keeping only navigation context. */
export function giftKindEntryHref(
  locale: SupportedLocale,
  kind: GiftKind,
  contextQuery: string,
) {
  const values = new URLSearchParams(contextQuery);
  for (const field of directoryFields) values.delete(field);
  values.set("kind", kind);
  return storefrontHref(locale, "/gifts", values.toString());
}

export function giftBrowseRecovery(
  locale: SupportedLocale,
  basePath: string,
  values: Values,
) {
  const query = new URLSearchParams(queryString(values));
  for (const field of fields) query.delete(field);
  return `${storefrontHref(locale, basePath, query.toString())}#gifts`;
}
