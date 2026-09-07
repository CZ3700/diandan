import "server-only";
import { minorAmountSchema } from "@fan-support/contracts";
import { formatStorefrontMessage } from "./copy";
import { formatGiftPriceInput, giftResetHref } from "./gift-query";
import { GiftFiltersClient } from "./gift-filters-client";
import type { GiftFilterProps } from "./gift-filter-types";
import { storefrontHref } from "./navigation";

/** Prepare stable presentation once; only actual editing needs browser validation. */
export function GiftFilters(props: GiftFilterProps) {
  const { query, locale, copy, basePath, contextQuery } = props;
  return (
    <GiftFiltersClient
      {...props}
      initialDraft={{
        sort: query.sort,
        category: query.category ?? "",
        availability: query.availability,
        minimum: formatGiftPriceInput(
          query.priceMinMinor,
          locale,
          query.currency,
        ),
        maximum: formatGiftPriceInput(
          query.priceMaxMinor,
          locale,
          query.currency,
        ),
      }}
      resetHref={giftResetHref(query, basePath, contextQuery)}
      recoveryHref={storefrontHref(locale, basePath, contextQuery)}
      hint={formatStorefrontMessage(copy, "giftPriceInputHint", locale, {
        currency: query.currency,
        example: formatGiftPriceInput(
          minorAmountSchema.parse(1234),
          locale,
          query.currency,
        ),
      })}
    />
  );
}
