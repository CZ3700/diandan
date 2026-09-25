import {
  CATALOG_DISCOVERY_LIMITS,
  DEFAULT_LOCALE,
  currencySchema,
  giftVariantIdSchema,
  marketSchema,
  policyKeySchema,
  slugSchema,
  supportedLocaleSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { prepareGiftQuery } from "./gift-query";

export type SeoPageKind =
  | "home"
  | "artists"
  | "artist"
  | "gifts"
  | "gift"
  | "policy"
  | "region"
  | "unavailable";
export type SeoSearchValues = Readonly<
  Record<string, string | string[] | undefined>
>;
export type SeoIdentity = Readonly<{ canonicalPath: string; noindex: boolean }>;

const directoryFields = [
  "page",
  "pageSize",
  "sort",
  "category",
  "priceMinMinor",
  "priceMaxMinor",
  "availability",
];

/** Only validated public identity enters metadata; navigation retains its own context separately. */
export function createSeoIdentity(
  locale: SupportedLocale,
  kind: SeoPageKind,
  handle: string | undefined,
  values: SeoSearchValues,
): SeoIdentity {
  supportedLocaleSchema.parse(locale);
  const detail = kind === "artist" || kind === "gift" || kind === "policy";
  const parsedHandle = (
    kind === "policy" ? policyKeySchema : slugSchema
  ).safeParse(handle);
  const basePath =
    kind === "home"
      ? ""
      : kind === "artists" || kind === "artist"
        ? "/idols"
        : kind === "gift" || kind === "gifts"
          ? "/gifts"
          : kind === "policy"
            ? "/policies"
            : `/${kind}`;
  const path = `/${locale}${basePath}${detail && parsedHandle.success ? `/${parsedHandle.data}` : ""}`;
  const allowed = new Set([
    "market",
    "currency",
    ...(kind === "gifts" ? directoryFields : []),
    ...(kind === "gift" ? ["variant"] : []),
  ]);
  let noindex =
    kind === "region" ||
    kind === "unavailable" ||
    (detail && !parsedHandle.success) ||
    Object.entries(values).some(
      ([key, value]) =>
        value !== undefined && (!allowed.has(key) || typeof value !== "string"),
    );
  const canonical = new URLSearchParams();
  const scoped =
    values["market"] !== undefined || values["currency"] !== undefined;
  const market = marketSchema.safeParse(values["market"]),
    currency = currencySchema.safeParse(values["currency"]);
  if (scoped && (!market.success || !currency.success)) noindex = true;
  if (
    market.success &&
    currency.success &&
    ["artist", "gift", "gifts"].includes(kind)
  ) {
    canonical.set("market", market.data);
    canonical.set("currency", currency.data);
  }
  if (kind === "gift" && values["variant"] !== undefined) {
    const variant = giftVariantIdSchema.safeParse(values["variant"]);
    if (variant.success && market.success && currency.success)
      canonical.set("variant", variant.data.toLowerCase());
    else noindex = true;
  }
  if (kind === "gifts") {
    const prepared = prepareGiftQuery(locale, values);
    if (!prepared.valid) noindex = true;
    else {
      const query = prepared.query;
      if (query.page !== 1) canonical.set("page", String(query.page));
      if (query.pageSize !== CATALOG_DISCOVERY_LIMITS.giftPageDefault) {
        canonical.set("pageSize", String(query.pageSize));
        noindex = true;
      }
      if (query.sort !== "RECOMMENDED") {
        canonical.set("sort", query.sort);
        noindex = true;
      }
      if (query.category !== undefined) {
        canonical.set("category", query.category);
        noindex = true;
      }
      for (const key of ["priceMinMinor", "priceMaxMinor"] as const)
        if (query[key] !== undefined) {
          canonical.set(key, String(query[key]));
          noindex = true;
        }
      if (query.availability !== "ALL") {
        canonical.set("availability", query.availability);
        noindex = true;
      }
    }
  }
  const search = canonical.toString();
  return { canonicalPath: `${path}${search ? `?${search}` : ""}`, noindex };
}

/** The caller supplies the same proven entity cluster on every locale page. */
export function seoAlternateUrls(
  origin: string,
  identity: SeoIdentity,
  availableLocales: readonly SupportedLocale[],
): Record<string, string> {
  const url = new URL(identity.canonicalPath, origin);
  const current = supportedLocaleSchema.safeParse(url.pathname.split("/")[1]);
  if (
    identity.noindex ||
    !current.success ||
    !availableLocales.includes(current.data)
  )
    return {};
  const result: Record<string, string> = {};
  for (const locale of availableLocales) {
    supportedLocaleSchema.parse(locale);
    const alternate = new URL(url);
    alternate.pathname = `/${locale}${url.pathname.slice(current.data.length + 1)}`;
    result[locale] = alternate.href;
  }
  if (result[DEFAULT_LOCALE]) result["x-default"] = result[DEFAULT_LOCALE];
  return result;
}
