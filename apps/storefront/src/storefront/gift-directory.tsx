import {
  CATALOG_DISCOVERY_LIMITS,
  type GiftDirectoryResponse,
  type GiftDiscoveryQuery,
  type SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { GiftDirectoryCard } from "./gift-directory-card";
import { GiftFilters } from "./gift-filters";
import { giftPageHref, giftResetHref } from "./gift-query";

export type GiftDirectoryProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  query: GiftDiscoveryQuery;
  initial: GiftDirectoryResponse;
  contextQuery?: string;
  basePath?: string;
  headingLevel?: 1 | 2;
}>;

function pageNumbers(page: number, totalPages: number): number[] {
  const last = Math.min(
    totalPages,
    CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum,
  );
  if (last < 1) return [];
  const center = Math.min(page, last);
  return [
    ...new Set([
      1,
      last,
      center - 2,
      center - 1,
      center,
      center + 1,
      center + 2,
    ]),
  ]
    .filter((number) => number >= 1 && number <= last)
    .sort((left, right) => left - right);
}

export function GiftDirectory({
  locale,
  copy,
  query,
  initial,
  contextQuery = "",
  basePath = "/gifts",
  headingLevel = 2,
}: GiftDirectoryProps) {
  const href = (page: number) =>
    giftPageHref(query, basePath, contextQuery, page);
  const Heading = headingLevel === 1 ? "h2" : "h3";
  const formatNumber = (number: number) =>
    new Intl.NumberFormat(locale).format(number);
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
  const { items, pageInfo } = initial;
  const outOfRange = pageInfo.page > Math.max(1, pageInfo.totalPages);
  const pages = pageNumbers(pageInfo.page, pageInfo.totalPages);
  const cardContext = contextQuery || href(query.page).split("?")[1] || "";
  return (
    <section
      className="gift-directory"
      data-gift-directory
      data-outcome="success"
    >
      <GiftFilters
        key={JSON.stringify(query)}
        locale={locale}
        copy={copy}
        query={query}
        contextQuery={contextQuery}
        basePath={basePath}
      />
      <p className="gift-directory-count">
        {formatStorefrontMessage(copy, "giftResultsCount", locale, {
          count: pageInfo.totalItems,
        })}
      </p>
      {items.length > 0 ? (
        <ul className="gift-directory-grid">
          {items.map((item) => (
            <GiftDirectoryCard
              key={item.gift.id}
              item={item}
              locale={locale}
              copy={copy}
              contextQuery={cardContext}
              headingLevel={headingLevel === 1 ? 2 : 3}
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
            href={
              outOfRange
                ? href(1)
                : giftResetHref(query, basePath, contextQuery)
            }
          >
            {outOfRange ? copy.giftFirstPage : copy.giftResetFilters}
          </a>
        </div>
      )}
      {(pageInfo.totalPages > 0 || outOfRange) && (
        <nav
          className="gift-pagination"
          aria-label={copy.giftPaginationLabel}
          data-gift-pagination
        >
          <p className="gift-pagination__summary">
            {formatStorefrontMessage(copy, "giftPaginationPage", locale, {
              page: formatNumber(pageInfo.page),
              total: formatNumber(pageInfo.totalPages),
            })}
          </p>
          <div className="gift-pagination__controls">
            {pageInfo.hasPreviousPage ? (
              <a href={href(pageInfo.page - 1)} data-gift-previous>
                {copy.giftPaginationPrevious}
              </a>
            ) : (
              <span aria-disabled="true" data-gift-previous>
                {copy.giftPaginationPrevious}
              </span>
            )}
            <ol className="gift-pagination__pages">
              {pages.map((page, index) => (
                <li key={page}>
                  {index > 0 && page - pages[index - 1]! > 1 && (
                    <span className="gift-pagination__gap" aria-hidden="true">
                      …
                    </span>
                  )}
                  <a
                    href={href(page)}
                    data-gift-page={page}
                    aria-current={page === pageInfo.page ? "page" : undefined}
                    aria-label={formatStorefrontMessage(
                      copy,
                      "giftPaginationGoToPage",
                      locale,
                      { page: formatNumber(page) },
                    )}
                  >
                    {formatNumber(page)}
                  </a>
                </li>
              ))}
            </ol>
            {pageInfo.hasNextPage ? (
              <a href={href(pageInfo.page + 1)} data-gift-next>
                {copy.giftPaginationNext}
              </a>
            ) : (
              <span aria-disabled="true" data-gift-next>
                {copy.giftPaginationNext}
              </span>
            )}
          </div>
          {pageInfo.paginationLimited && (
            <p className="gift-pagination__limited">
              {formatStorefrontMessage(copy, "giftPaginationLimited", locale, {
                limit: formatNumber(
                  CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum,
                ),
              })}
            </p>
          )}
        </nav>
      )}
    </section>
  );
}
