import type { SupportedLocale } from "@fan-support/contracts";
import { requireCanonicalLocale } from "../canonical-locale";
export function storefrontHref(
  locale: SupportedLocale,
  path: string,
  currentSearch = "",
): string {
  const canonical = requireCanonicalLocale(locale);
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/u.test(path))
    throw new TypeError("Expected a local storefront path");
  const query = new URLSearchParams(currentSearch);
  return `/${canonical}${path === "/" ? "" : path}${query.size ? `?${query}` : ""}`;
}
export function queryString(
  values: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.set(key, value);
  }
  return query.toString();
}
