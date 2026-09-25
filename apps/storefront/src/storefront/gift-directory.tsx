import { GiftPagination } from "./gift-pagination";
import {
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
      <GiftPagination
        pageInfo={pageInfo}
        locale={locale}
        copy={copy}
        href={href}
      />
    </section>
  );
}
