import type { ReactNode } from "react";
import type {
  CatalogDirectoryOffer,
  CatalogPageInfo,
  GiftDiscoveryQuery,
  GiftKind,
  PublishedGiftView,
  SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { GiftCard } from "./gift-card";
import { BROWSABLE_GIFT_KINDS, giftKindLabel } from "./gift-kind-copy";
import { GiftPagination } from "./gift-pagination";
import { GiftToolbar } from "./gift-toolbar";

type Sort = GiftDiscoveryQuery["sort"];

/**
 * The toolbar, cards and pagination shared by the content list and the priced directory.
 * Each caller owns its own addresses; every link here is a real one.
 */
export function GiftListing({
  locale,
  copy,
  headingLevel,
  items,
  pageInfo,
  cardContext,
  kind,
  kindHref,
  sort,
  applied,
  pageHref,
  resetHref,
  pricePending = false,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  headingLevel: 1 | 2;
  items: ReadonlyArray<
    Readonly<{
      gift: PublishedGiftView;
      offer?: CatalogDirectoryOffer | undefined;
    }>
  >;
  pageInfo: CatalogPageInfo;
  /** Navigation context each card carries into its gift page. */
  cardContext: string;
  kind: GiftKind | undefined;
  kindHref(kind: GiftKind | undefined): string;
  /** Only a priced list can be ordered by price. */
  sort?: Readonly<{ current: Sort; href(sort: Sort): string }> | undefined;
  /** Filters an address can still carry although the toolbar no longer offers them. */
  applied?:
    | Readonly<{ labels: ReadonlyArray<ReactNode>; clearHref: string }>
    | undefined;
  pageHref(page: number): string;
  resetHref: string;
  pricePending?: boolean;
}>) {
  const Heading = headingLevel === 1 ? "h2" : "h3";
  const outOfRange = pageInfo.page > Math.max(1, pageInfo.totalPages);
  const kinds = [
    ...BROWSABLE_GIFT_KINDS,
    ...(kind === "OTHER" ? (["OTHER"] as const) : []),
  ];
  return (
    <>
      <GiftToolbar
        kindsLabel={copy.giftKindLabel}
        kinds={[
          {
            id: "ALL",
            label: copy.giftKindAll,
            href: kindHref(undefined),
            current: kind === undefined,
          },
          ...kinds.map((value) => ({
            id: value,
            label: giftKindLabel(copy, value),
            href: kindHref(value),
            current: kind === value,
          })),
        ]}
        count={formatStorefrontMessage(copy, "giftResultsCount", locale, {
          count: pageInfo.totalItems,
        })}
        sort={
          sort && {
            heading: copy.giftSortLabel,
            label: copy.giftSortPrice,
            options: (
              [
                ["PRICE_ASC", copy.giftSortPriceAsc, "sort-ascending"],
                ["PRICE_DESC", copy.giftSortPriceDesc, "sort-descending"],
              ] as const
            ).map(([id, label, icon]) => ({
              id,
              label,
              icon,
              current: sort.current === id,
              href: sort.href(sort.current === id ? "RECOMMENDED" : id),
            })),
          }
        }
      />
      {applied && applied.labels.length > 0 && (
        <div className="gift-filter-summary" data-gift-applied-filters>
          <ul aria-label={copy.giftFilters}>
            {applied.labels.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          <a
            className="storefront-text-link"
            href={applied.clearHref}
            data-gift-nav="reset"
            data-gift-reset
          >
            {copy.giftResetFilters}
          </a>
        </div>
      )}
      {items.length > 0 ? (
        <ul className="gift-directory-grid">
          {items.map(({ gift, offer }) => (
            <GiftCard
              key={gift.id}
              gift={gift}
              offer={offer}
              locale={locale}
              copy={copy}
              contextQuery={cardContext}
              headingLevel={headingLevel === 1 ? 2 : 3}
              pricePending={pricePending}
            />
          ))}
        </ul>
      ) : (
        <div
          className="gift-directory-state"
          data-gift-empty
          data-gift-page-out-of-range={outOfRange || undefined}
        >
          <Heading>
            {outOfRange
              ? copy.giftPageOutOfRangeTitle
              : copy.giftNoResultsTitle}
          </Heading>
          <p>
            {outOfRange ? copy.giftPageOutOfRangeBody : copy.giftNoResultsBody}
          </p>
          <a
            className="storefront-primary"
            href={outOfRange ? pageHref(1) : resetHref}
            data-gift-nav="reset"
          >
            {outOfRange ? copy.giftFirstPage : copy.giftResetFilters}
          </a>
        </div>
      )}
      <GiftPagination
        pageInfo={pageInfo}
        locale={locale}
        copy={copy}
        href={pageHref}
      />
    </>
  );
}
