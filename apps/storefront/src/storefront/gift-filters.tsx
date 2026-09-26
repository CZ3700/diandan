import "server-only";
import { minorAmountSchema } from "@fan-support/contracts";
import { formatStorefrontMessage } from "./copy";
import {
  formatGiftPriceInput,
  giftFilterHref,
  giftResetHref,
} from "./gift-query";
import { GiftFiltersClient } from "./gift-filters-client";
import { BROWSABLE_GIFT_KINDS, giftKindLabel } from "./gift-kind-copy";
import type { GiftFilterProps } from "./gift-filter-types";
import { storefrontHref } from "./navigation";

/** Prepare stable presentation once; only actual editing needs browser validation. */
export function GiftFilters(props: GiftFilterProps) {
  const {
    query,
    locale,
    copy,
    basePath,
    contextQuery,
    scope = "EXPLICIT",
  } = props;
  const categories = {
    FLOWERS: copy.giftCategoryFlowers,
    FOOD: copy.giftCategoryFood,
    BEAUTY: copy.giftCategoryBeauty,
    ACCESSORY: copy.giftCategoryAccessory,
    OTHER: copy.giftCategoryOther,
  };
  const appliedFilters: string[] = [];
  if (query.kind)
    appliedFilters.push(
      `${copy.giftKindLabel}: ${giftKindLabel(copy, query.kind)}`,
    );
  if (query.category)
    appliedFilters.push(
      `${copy.giftCategoryLabel}: ${categories[query.category]}`,
    );
  if (query.availability !== "ALL") {
    const availability =
      query.availability === "PURCHASABLE"
        ? copy.giftAvailabilityPurchasable
        : copy.giftAvailabilityUnavailable;
    appliedFilters.push(`${copy.giftAvailabilityLabel}: ${availability}`);
  }
  for (const [label, amount] of [
    [copy.giftPriceMinimum, query.priceMinMinor],
    [copy.giftPriceMaximum, query.priceMaxMinor],
  ] as const)
    if (amount !== undefined)
      appliedFilters.push(
        `${label}: ${formatGiftPriceInput(amount, locale, query.currency)} ${query.currency}`,
      );
  const sortLabels = [
    ["RECOMMENDED", copy.giftSortRecommended],
    ["PRICE_ASC", copy.giftSortPriceAsc],
    ["PRICE_DESC", copy.giftSortPriceDesc],
  ] as const;
  return (
    <GiftFiltersClient
      {...props}
      appliedFilters={appliedFilters}
      sortOptions={sortLabels.map(([value, label]) => ({
        value,
        label,
        href: giftFilterHref(
          query,
          basePath,
          contextQuery,
          {
            sort: value,
            kind: query.kind,
            category: query.category,
            availability: query.availability,
            priceMinMinor: query.priceMinMinor,
            priceMaxMinor: query.priceMaxMinor,
          },
          scope,
        ),
      }))}
      kindOptions={[
        ...BROWSABLE_GIFT_KINDS,
        ...(query.kind === "OTHER" ? (["OTHER"] as const) : []),
      ].map((value) => ({ value, label: giftKindLabel(copy, value) }))}
      initialDraft={{
        sort: query.sort,
        kind: query.kind ?? "",
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
      resetHref={giftResetHref(query, basePath, contextQuery, scope)}
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
