import type {
  CatalogDirectoryOffer,
  GiftBrowseQuery,
  GiftBrowseResponse,
  GiftDirectoryResponse,
  PublishedGiftView,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { GiftCard } from "./gift-card";
import { GiftPagination } from "./gift-pagination";
import { giftBrowseHref } from "./gift-browse-query";
import { BROWSABLE_GIFT_KINDS, giftKindLabel } from "./gift-kind-copy";
import { storefrontHref } from "./navigation";

export function GiftBrowse({
  query,
  initial,
  copy,
  contextQuery,
  basePath,
  headingLevel,
}: Readonly<{
  query: GiftBrowseQuery;
  /** A priced response comes from the sole published market (ADR-017 addendum). */
  initial: GiftBrowseResponse | GiftDirectoryResponse;
  copy: StorefrontCopy;
  contextQuery: string;
  basePath: string;
  headingLevel: 1 | 2;
}>) {
  const Heading = headingLevel === 1 ? "h2" : "h3";
  const href = (page: number) =>
    giftBrowseHref(query, basePath, contextQuery, page);
  if (initial.outcome === "FAILURE")
    return (
      <div
        className="gift-directory gift-directory-state"
        data-gift-browse
        data-outcome="failure"
      >
        <Heading>{copy.contentError}</Heading>
        <p>{copy.contentErrorBody}</p>
        <a
          className="storefront-primary"
          href={href(query.page)}
          data-gift-retry
        >
          {copy.artistRetry}
        </a>
      </div>
    );
  const { pageInfo } = initial;
  const entries: ReadonlyArray<
    | PublishedGiftView
    | Readonly<{ gift: PublishedGiftView; offer: CatalogDirectoryOffer }>
  > = initial.items;
  const items = entries.map((entry) =>
    "offer" in entry ? entry : { gift: entry, offer: undefined },
  );
  const outOfRange = pageInfo.page > Math.max(1, pageInfo.totalPages);
  const categories = {
    FLOWERS: copy.giftCategoryFlowers,
    FOOD: copy.giftCategoryFood,
    BEAUTY: copy.giftCategoryBeauty,
    ACCESSORY: copy.giftCategoryAccessory,
    OTHER: copy.giftCategoryOther,
  };
  const retained = [...new URLSearchParams(contextQuery)].filter(
    ([key]) =>
      ![
        "category",
        "kind",
        "page",
        "pageSize",
        "sort",
        "priceMinMinor",
        "priceMaxMinor",
        "availability",
      ].includes(key),
  );
  return (
    <div
      id={basePath !== "/" ? "gifts" : undefined}
      className="gift-directory"
      data-gift-browse
      data-gift-priced={items.some((item) => item.offer) || undefined}
      data-outcome="success"
    >
      <form
        className="gift-filter-toolbar gift-browse-filters"
        action={`${storefrontHref(query.locale, basePath, "")}#gifts`}
        method="get"
      >
        {retained.map(([name, value], index) => (
          <input
            key={`${name}-${index}`}
            type="hidden"
            name={name}
            value={value}
          />
        ))}
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="pageSize" value={query.pageSize} />
        <label className="gift-filter-sort">
          <span>{copy.giftKindLabel}</span>
          <select
            name="kind"
            defaultValue={query.kind ?? ""}
            data-gift-browse-kind
          >
            <option value="">{copy.giftKindAll}</option>
            {[
              ...BROWSABLE_GIFT_KINDS,
              ...(query.kind === "OTHER" ? (["OTHER"] as const) : []),
            ].map((kind) => (
              <option key={kind} value={kind}>
                {giftKindLabel(copy, kind)}
              </option>
            ))}
          </select>
        </label>
        <label className="gift-filter-sort">
          <span>{copy.giftCategoryLabel}</span>
          <select
            name="category"
            defaultValue={query.category ?? ""}
            data-gift-browse-category
          >
            <option value="">{copy.giftCategoryAll}</option>
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="storefront-text-link" type="submit">
          {copy.giftApplyFilters}
        </button>
      </form>
      <p className="gift-directory-count">
        {formatStorefrontMessage(copy, "giftResultsCount", query.locale, {
          count: pageInfo.totalItems,
        })}
      </p>
      {items.length > 0 ? (
        <ul className="gift-directory-grid">
          {items.map(({ gift, offer }) => (
            <GiftCard
              key={gift.id}
              gift={gift}
              offer={offer}
              locale={query.locale}
              copy={copy}
              contextQuery={contextQuery}
              headingLevel={headingLevel === 1 ? 2 : 3}
              description
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
            href={giftBrowseHref(query, basePath, contextQuery, 1, !outOfRange)}
          >
            {outOfRange ? copy.giftFirstPage : copy.giftResetFilters}
          </a>
        </div>
      )}
      <GiftPagination
        pageInfo={pageInfo}
        locale={query.locale}
        copy={copy}
        href={href}
      />
    </div>
  );
}
