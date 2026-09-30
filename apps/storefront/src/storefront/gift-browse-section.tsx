import "server-only";
import { Suspense, type ReactNode } from "react";
import type {
  GiftBrowseResponse,
  StorefrontContextResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { readGiftBrowse } from "../server/public-gift-browse";
import type { StorefrontCopy } from "./copy";
import { GiftBrowse } from "./gift-browse";
import { giftBrowseRecovery, prepareGiftBrowse } from "./gift-browse-query";
import { GiftNavigationFrame } from "./gift-navigation-frame";
import { queryString } from "./navigation";
import {
  SoleMarketGiftDirectory,
  type PricedGiftDirectoryRenderer,
} from "./sole-market-directory";

type Values = Readonly<Record<string, string | string[] | undefined>>;
type Props = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Values;
  basePath?: string;
  headingLevel?: 1 | 2;
  initial?: Promise<GiftBrowseResponse> | undefined;
  /**
   * Price the list in place once one published market is confirmed; the content list streams
   * first. Without a renderer the priced cards keep this compact list and its toolbar.
   */
  pricing?: Readonly<{
    render?: PricedGiftDirectoryRenderer;
    context?:
      | StorefrontContextResponse
      | Promise<StorefrontContextResponse>
      | undefined;
  }>;
}>;

/**
 * A price order, a price range or an availability filter needs prices: the content list
 * would show other gifts in another order, so it is not shown while they are read.
 */
function needsPrices(values: Values) {
  const chosen = (name: string, neutral: string) =>
    values[name] !== undefined && values[name] !== neutral;
  return (
    chosen("sort", "RECOMMENDED") ||
    chosen("availability", "ALL") ||
    values["priceMinMinor"] !== undefined ||
    values["priceMaxMinor"] !== undefined
  );
}

/** Holds the list's place with the same card shapes; it names no gift and no price. */
export function GiftListPlaceholder({
  copy,
  cards,
}: Readonly<{ copy: StorefrontCopy; cards: number }>) {
  return (
    <div className="gift-directory" data-gift-placeholder aria-busy="true">
      <p className="storefront-sr-only" role="status">
        {copy.loading}
      </p>
      <ul className="gift-directory-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <li key={index} className="gift-directory-card">
            <div className="gift-directory-card__media">
              <span />
            </div>
            <div className="gift-directory-card__body">
              <span />
              <span />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function GiftBrowseBody({
  locale,
  copy,
  values,
  basePath = "/gifts",
  headingLevel = 1,
  initial,
  pricing,
}: Props) {
  const query = prepareGiftBrowse(locale, values);
  const contextQuery = queryString(values);
  const browse = query ? await (initial ?? readGiftBrowse(query)) : undefined;
  const list = (pricePending = false): ReactNode =>
    query && browse ? (
      <GiftBrowse
        query={query}
        initial={browse}
        copy={copy}
        contextQuery={contextQuery}
        basePath={basePath}
        headingLevel={headingLevel}
        pricePending={pricePending}
      />
    ) : (
      <div className="gift-directory-state">
        <p role="status">{copy.contentErrorBody}</p>
        <a
          className="storefront-primary"
          data-gift-query-recovery
          href={giftBrowseRecovery(locale, basePath, values)}
        >
          {copy.giftResetFilters}
        </a>
      </div>
    );
  const content = list();
  if (!pricing) return content;
  const render: PricedGiftDirectoryRenderer | undefined =
    pricing.render ??
    (query
      ? (priced) => (
          <GiftBrowse
            query={query}
            initial={priced.initial}
            copy={copy}
            contextQuery={priced.contextQuery}
            basePath={basePath}
            headingLevel={headingLevel}
            sort={priced.query.sort}
          />
        )
      : undefined);
  if (!render) return content;
  const cards = browse?.outcome === "SUCCESS" ? browse.items.length : 0;
  // The content list is the result whenever no single market prices it. Until that is
  // known it streams first with its price lines held, so prices arrive in place.
  return (
    <Suspense
      fallback={
        needsPrices(values) && cards > 0 ? (
          <GiftListPlaceholder copy={copy} cards={cards} />
        ) : (
          list(true)
        )
      }
    >
      <SoleMarketGiftDirectory
        locale={locale}
        values={values}
        fallback={content}
        context={pricing.context}
        render={render}
      />
    </Suspense>
  );
}

export function GiftBrowseSection(props: Props) {
  const Heading = props.headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      className="storefront-section storefront-gifts"
      id="gifts"
      aria-labelledby="featured-gifts-title"
    >
      {/* User request 2026-09-30 (L2-17): the section starts at its gifts, with no visible title. */}
      <Heading id="featured-gifts-title" className="storefront-sr-only">
        {props.copy.navGifts}
      </Heading>
      <GiftNavigationFrame>
        <Suspense
          fallback={
            <p role="status" aria-busy="true">
              {props.copy.loading}
            </p>
          }
        >
          <GiftBrowseBody {...props} />
        </Suspense>
      </GiftNavigationFrame>
    </section>
  );
}
