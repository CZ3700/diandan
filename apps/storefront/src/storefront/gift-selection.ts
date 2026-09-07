import {
  currencySchema,
  marketSchema,
  idolIdSchema,
  giftVariantIdSchema,
  type CurrencyCode,
  type MarketCode,
  type IdolId,
  type GiftVariantId,
  type SupportedLocale,
  type StorefrontGiftOffer,
} from "@fan-support/contracts";
import { storefrontHref } from "./navigation";

type Values = Readonly<Record<string, string | string[] | undefined>>;
type Selection =
  | Readonly<{
      kind: "VALID";
      market: MarketCode;
      currency: CurrencyCode;
      idolId?: IdolId;
      variantId?: GiftVariantId;
    }>
  | Readonly<{ kind: "CONTEXT_REQUIRED" | "INVALID_QUERY" }>;

export function parseGiftSelection(values: Values): Selection {
  const idol =
    values["idol"] === undefined
      ? undefined
      : idolIdSchema.safeParse(values["idol"]);
  const variant =
    values["variant"] === undefined
      ? undefined
      : giftVariantIdSchema.safeParse(values["variant"]);
  if (idol?.success === false || variant?.success === false)
    return { kind: "INVALID_QUERY" };
  if (values["market"] === undefined && values["currency"] === undefined)
    return { kind: "CONTEXT_REQUIRED" };
  const market = marketSchema.safeParse(values["market"]);
  const currency = currencySchema.safeParse(values["currency"]);
  if (!market.success || !currency.success) return { kind: "INVALID_QUERY" };
  return {
    kind: "VALID",
    market: market.data,
    currency: currency.data,
    ...(idol?.success ? { idolId: idol.data } : {}),
    ...(variant?.success ? { variantId: variant.data } : {}),
  };
}

/** Local route and structured query fields; never accepts a redirect URL. */
export function giftSelectionHref(
  locale: SupportedLocale,
  path: string,
  contextQuery: string,
  changes: Readonly<{
    idol?: string;
    variant?: string;
    market?: string;
    currency?: string;
  }>,
): string {
  const query = new URLSearchParams(contextQuery);
  query.delete("page");
  if (
    changes.idol !== undefined ||
    changes.market !== undefined ||
    changes.currency !== undefined
  )
    query.delete("variant");
  if (changes.market !== undefined || changes.currency !== undefined) {
    query.delete("priceMinMinor");
    query.delete("priceMaxMinor");
  }
  for (const [key, value] of Object.entries(changes)) query.set(key, value);
  return storefrontHref(locale, path, query.toString());
}

/** Recover a browse URL without carrying malformed selectors into another request. */
export function giftRecoveryQuery(contextQuery: string): string {
  const query = new URLSearchParams(contextQuery);
  for (const field of [
    "page",
    "pageSize",
    "category",
    "sort",
    "priceMinMinor",
    "priceMaxMinor",
    "availability",
    "variant",
  ])
    query.delete(field);
  for (const [field, schema] of [
    ["market", marketSchema],
    ["currency", currencySchema],
    ["idol", idolIdSchema],
  ] as const) {
    if (
      query.has(field) &&
      (query.getAll(field).length !== 1 ||
        !schema.safeParse(query.get(field)).success)
    )
      query.delete(field);
  }
  return query.toString();
}

/** SEO only carries public page identity; session and tracking context stays out. */
export function giftCanonicalPath(
  locale: SupportedLocale,
  path: string,
  contextQuery: string,
): string {
  const current = new URLSearchParams(contextQuery);
  const canonical = new URLSearchParams();
  const keys =
    path === "/gifts"
      ? [
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
        ]
      : path.startsWith("/gifts/")
        ? ["market", "currency", "idol", "variant"]
        : [];
  for (const key of keys) {
    const values = current.getAll(key);
    if (values.length === 1 && values[0] !== undefined)
      canonical.set(key, values[0]);
  }
  return storefrontHref(locale, path, canonical.toString());
}

export function selectGiftOffer(
  offers: readonly StorefrontGiftOffer[],
  variantId?: string,
) {
  if (variantId !== undefined)
    return offers.find(
      (offer) => offer.giftVariantId.toLowerCase() === variantId.toLowerCase(),
    );
  let lowest: (typeof offers)[number] | undefined;
  for (const offer of offers) {
    if (offer.availability === "UNAVAILABLE" || offer.price === null) continue;
    if (
      lowest?.price === undefined ||
      lowest.price === null ||
      offer.price.unitAmountMinor < lowest.price.unitAmountMinor ||
      (offer.price.unitAmountMinor === lowest.price.unitAmountMinor &&
        offer.giftVariantId < lowest.giftVariantId)
    )
      lowest = offer;
  }
  return lowest ?? offers[0];
}
