import "server-only";
import { Suspense } from "react";
import type {
  GiftBrowseResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { readGiftBrowse } from "../server/public-gift-browse";
import type { StorefrontCopy } from "./copy";
import { GiftBrowse } from "./gift-browse";
import { giftBrowseRecovery, prepareGiftBrowse } from "./gift-browse-query";
import { queryString } from "./navigation";

type Props = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Readonly<Record<string, string | string[] | undefined>>;
  basePath?: string;
  headingLevel?: 1 | 2;
  initial?: Promise<GiftBrowseResponse> | undefined;
}>;

export async function GiftBrowseBody({
  locale,
  copy,
  values,
  basePath = "/gifts",
  headingLevel = 1,
  initial,
}: Props) {
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
