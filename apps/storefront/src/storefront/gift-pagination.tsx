import {
  CATALOG_DISCOVERY_LIMITS,
  type CatalogPageInfo,
  type SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";

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

export function GiftPagination({
  pageInfo,
  locale,
  copy,
  href,
}: Readonly<{
  pageInfo: CatalogPageInfo;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  href(page: number): string;
}>) {
  const outOfRange = pageInfo.page > Math.max(1, pageInfo.totalPages);
  const pages = pageNumbers(pageInfo.page, pageInfo.totalPages);
  const formatNumber = (number: number) =>
    new Intl.NumberFormat(locale).format(number);
  return (
    <>
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
    </>
  );
}
