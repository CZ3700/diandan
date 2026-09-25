import type {
  SupportedLocale,
  StorefrontGiftOffer,
} from "@fan-support/contracts";
import { storefrontHref } from "./navigation";

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
