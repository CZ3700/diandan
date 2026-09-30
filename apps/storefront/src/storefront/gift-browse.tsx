import type {
  CatalogDirectoryOffer,
  GiftBrowseQuery,
  GiftBrowseResponse,
  GiftDirectoryResponse,
  GiftDiscoveryQuery,
  PublishedGiftView,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { GiftListing } from "./gift-listing";
import { giftBrowseChoiceHref, giftBrowseHref } from "./gift-browse-query";

export function GiftBrowse({
  query,
  initial,
  copy,
  contextQuery,
  basePath,
  headingLevel,
  sort,
  pricePending = false,
}: Readonly<{
  query: GiftBrowseQuery;
  /** A priced response comes from the sole published market (ADR-017 addendum). */
  initial: GiftBrowseResponse | GiftDirectoryResponse;
  copy: StorefrontCopy;
  contextQuery: string;
  basePath: string;
  headingLevel: 1 | 2;
  /** The order of a priced response; a content list has no price to order by. */
  sort?: GiftDiscoveryQuery["sort"] | undefined;
  /** The content list shown while the sole market's prices are still being read. */
  pricePending?: boolean;
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
  const entries: ReadonlyArray<
    | PublishedGiftView
    | Readonly<{ gift: PublishedGiftView; offer: CatalogDirectoryOffer }>
  > = initial.items;
  const items = entries.map((entry) =>
    "offer" in entry ? entry : { gift: entry, offer: undefined },
  );
  const categories = {
    FLOWERS: copy.giftCategoryFlowers,
    FOOD: copy.giftCategoryFood,
    BEAUTY: copy.giftCategoryBeauty,
    ACCESSORY: copy.giftCategoryAccessory,
    OTHER: copy.giftCategoryOther,
  };
  return (
    <div
      id={basePath !== "/" ? "gifts" : undefined}
      className="gift-directory"
      data-gift-browse
      data-gift-priced={items.some((item) => item.offer) || undefined}
      data-outcome="success"
    >
      <GiftListing
        locale={query.locale}
        copy={copy}
        headingLevel={headingLevel}
        items={items}
        pageInfo={initial.pageInfo}
        cardContext={contextQuery}
        kind={query.kind}
        kindHref={(kind) =>
          giftBrowseChoiceHref(query, basePath, contextQuery, {
            kind: kind ?? null,
          })
        }
        sort={
          sort && {
            current: sort,
            href: (next) =>
              giftBrowseChoiceHref(query, basePath, contextQuery, {
                sort: next,
              }),
          }
        }
        applied={
          query.category && {
            labels: [
              `${copy.giftCategoryLabel}: ${categories[query.category]}`,
            ],
            clearHref: giftBrowseChoiceHref(query, basePath, contextQuery, {
              category: null,
            }),
          }
        }
        pageHref={href}
        resetHref={giftBrowseHref(query, basePath, contextQuery, 1, true)}
        pricePending={pricePending}
      />
    </div>
  );
}
