import type {
  GiftDiscoveryQuery,
  SupportedLocale,
} from "@fan-support/contracts";
import { giftFilterHref, parseGiftPriceInput } from "./gift-query";
import type { GiftFilterDraft } from "./gift-filter-types";

/** Loaded on submit; both local amounts and the final query use canonical schemas. */
export function validateGiftFilterDraft(
  draft: GiftFilterDraft,
  locale: SupportedLocale,
  query: GiftDiscoveryQuery,
  basePath: string,
  contextQuery: string,
):
  | Readonly<{ kind: "VALID"; href: string }>
  | Readonly<{
      kind: "INVALID";
      minimum: boolean;
      maximum: false | "INVALID" | "RANGE";
    }> {
  const minimum = parseGiftPriceInput(draft.minimum, locale, query.currency);
  const maximum = parseGiftPriceInput(draft.maximum, locale, query.currency);
  if (!minimum.valid || !maximum.valid)
    return {
      kind: "INVALID",
      minimum: !minimum.valid,
      maximum: maximum.valid ? false : "INVALID",
    };
  if (
    minimum.amountMinor !== undefined &&
    maximum.amountMinor !== undefined &&
    minimum.amountMinor > maximum.amountMinor
  )
    return { kind: "INVALID", minimum: false, maximum: "RANGE" };
  return {
    kind: "VALID",
    href: giftFilterHref(query, basePath, contextQuery, {
      sort: draft.sort,
      availability: draft.availability,
      ...(draft.category
        ? {
            category: draft.category as NonNullable<
              GiftDiscoveryQuery["category"]
            >,
          }
        : {}),
      ...(minimum.amountMinor !== undefined
        ? { priceMinMinor: minimum.amountMinor }
        : {}),
      ...(maximum.amountMinor !== undefined
        ? { priceMaxMinor: maximum.amountMinor }
        : {}),
    }),
  };
}
