import {
  giftBrowseQuerySchema,
  type GiftBrowseQuery,
  type SupportedLocale,
} from "@fan-support/contracts";
import { queryString, storefrontHref } from "./navigation";

type Values = Readonly<Record<string, string | string[] | undefined>>;
const fields = ["page", "pageSize", "category", "idol"] as const;

export function prepareGiftBrowse(locale: SupportedLocale, values: Values) {
  const input: Record<string, unknown> = { schemaVersion: 1, locale };
  for (const key of fields) {
    const value = values[key];
    if (value === undefined || (key === "category" && value === "")) continue;
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
  return `${storefrontHref(query.locale, basePath, values.toString())}#gifts`;
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
