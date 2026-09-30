import type { ReactNode } from "react";
import {
  type GiftDirectoryResponse,
  type GiftDiscoveryQuery,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { GiftListing } from "./gift-listing";
import {
  giftFilterHref,
  giftPageHref,
  giftResetHref,
  type GiftFilters,
  type GiftScopeInUrl,
} from "./gift-query";

export type GiftDirectoryProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  query: GiftDiscoveryQuery;
  initial: GiftDirectoryResponse;
  contextQuery?: string;
  basePath?: string;
  headingLevel?: 1 | 2;
  scope?: GiftScopeInUrl;
}>;

export function GiftDirectory({
  locale,
  copy,
  query,
  initial,
  contextQuery = "",
  basePath = "/gifts",
  headingLevel = 2,
  scope = "EXPLICIT",
}: GiftDirectoryProps) {
  const href = (page: number) =>
    giftPageHref(query, basePath, contextQuery, page, scope);
  const Heading = headingLevel === 1 ? "h2" : "h3";
  if (initial.outcome === "FAILURE")
    return (
      <section
        className="gift-directory gift-directory-state"
        data-gift-directory
        data-outcome="failure"
      >
        <Heading>{copy.contentError}</Heading>
        <p>{copy.contentErrorBody}</p>
        <a
          href={href(query.page)}
          className="storefront-primary"
          data-gift-retry
        >
          {copy.artistRetry}
        </a>
      </section>
    );
  const filters: GiftFilters = {
    sort: query.sort,
    kind: query.kind,
    category: query.category,
    availability: query.availability,
    priceMinMinor: query.priceMinMinor,
    priceMaxMinor: query.priceMaxMinor,
  };
  const choose = (change: Partial<GiftFilters>) =>
    giftFilterHref(
      query,
      basePath,
      contextQuery,
      { ...filters, ...change },
      scope,
    );
  const categories = {
    FLOWERS: copy.giftCategoryFlowers,
    FOOD: copy.giftCategoryFood,
    BEAUTY: copy.giftCategoryBeauty,
    ACCESSORY: copy.giftCategoryAccessory,
    OTHER: copy.giftCategoryOther,
  };
  // The toolbar offers only kinds and a price order; an address may still carry these.
  const applied: ReactNode[] = [];
  if (query.category)
    applied.push(`${copy.giftCategoryLabel}: ${categories[query.category]}`);
  if (query.availability !== "ALL")
    applied.push(
      `${copy.giftAvailabilityLabel}: ${
        query.availability === "PURCHASABLE"
          ? copy.giftAvailabilityPurchasable
          : copy.giftAvailabilityUnavailable
      }`,
    );
  for (const [label, amount] of [
    [copy.giftPriceMinimum, query.priceMinMinor],
    [copy.giftPriceMaximum, query.priceMaxMinor],
  ] as const)
    if (amount !== undefined)
      applied.push(
        <>
          {label}:{" "}
          <Price
            amountMinor={amount}
            currency={query.currency}
            locale={locale}
          />
        </>,
      );
  return (
    <section
      className="gift-directory"
      data-gift-directory
      data-outcome="success"
    >
      <GiftListing
        locale={locale}
        copy={copy}
        headingLevel={headingLevel}
        items={initial.items}
        pageInfo={initial.pageInfo}
        cardContext={contextQuery || href(query.page).split("?")[1] || ""}
        kind={query.kind}
        kindHref={(kind) => choose({ kind })}
        sort={{ current: query.sort, href: (sort) => choose({ sort }) }}
        applied={{
          labels: applied,
          clearHref: choose({
            category: undefined,
            availability: "ALL",
            priceMinMinor: undefined,
            priceMaxMinor: undefined,
          }),
        }}
        pageHref={href}
        resetHref={giftResetHref(query, basePath, contextQuery, scope)}
      />
    </section>
  );
}
