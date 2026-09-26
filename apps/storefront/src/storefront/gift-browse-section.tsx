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
import { queryString } from "./navigation";
import {
  SoleMarketGiftDirectory,
  type PricedGiftDirectoryRenderer,
} from "./sole-market-directory";

type Props = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Readonly<Record<string, string | string[] | undefined>>;
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

async function ContentGiftBrowse({
  locale,
  copy,
  values,
  basePath,
  headingLevel,
  initial,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Props["values"];
  basePath: string;
  headingLevel: 1 | 2;
  initial: Props["initial"];
}>): Promise<ReactNode> {
  const query = prepareGiftBrowse(locale, values);
  if (!query)
    return (
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
  return (
    <GiftBrowse
      query={query}
      initial={await (initial ?? readGiftBrowse(query))}
      copy={copy}
      contextQuery={queryString(values)}
      basePath={basePath}
      headingLevel={headingLevel}
    />
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
  const content = await ContentGiftBrowse({
    locale,
    copy,
    values,
    basePath,
    headingLevel,
    initial,
  });
  if (!pricing) return content;
  const query = prepareGiftBrowse(locale, values);
  const render: PricedGiftDirectoryRenderer | undefined =
    pricing.render ??
    (query
      ? ({ initial, contextQuery }) => (
          <GiftBrowse
            query={query}
            initial={initial}
            copy={copy}
            contextQuery={contextQuery}
            basePath={basePath}
            headingLevel={headingLevel}
          />
        )
      : undefined);
  if (!render) return content;
  // The content list is both the streamed fallback and the result whenever no single market prices it.
  return (
    <Suspense fallback={content}>
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
      <div className="storefront-section-heading">
        <div>
          <p className="storefront-eyebrow">{props.copy.giftEyebrow}</p>
          <Heading id="featured-gifts-title">{props.copy.giftTitle}</Heading>
        </div>
        <p>{props.copy.giftBody}</p>
      </div>
      <Suspense
        fallback={
          <p role="status" aria-busy="true">
            {props.copy.loading}
          </p>
        }
      >
        <GiftBrowseBody {...props} />
      </Suspense>
    </section>
  );
}
