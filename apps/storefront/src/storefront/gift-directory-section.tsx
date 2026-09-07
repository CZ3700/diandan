import "server-only";
import type {
  PublishedIdolView,
  StorefrontContextResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { giftDirectoryRead } from "./gift-page-reads";
import { prepareGiftQuery } from "./gift-query";
import { GiftDirectory } from "./gift-directory";
import { isMarketAvailable, MarketChoices } from "./commerce-context";
import { giftRecoveryQuery } from "./gift-selection";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";

export async function GiftDirectorySection({
  locale,
  copy,
  values,
  context,
  basePath = "/gifts",
  headingLevel = 1,
  artist,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Readonly<Record<string, string | string[] | undefined>>;
  context: StorefrontContextResponse;
  basePath?: string;
  headingLevel?: 1 | 2;
  artist?: PublishedIdolView;
}>) {
  const prepared = prepareGiftQuery(locale, values);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const query = prepared.contextQuery;
  let body;
  if (!prepared.valid)
    body = (
      <>
        {prepared.reason === "INVALID_QUERY" && (
          <>
            <p role="status">{copy.contentErrorBody}</p>
            <a
              className="storefront-text-link"
              data-gift-query-recovery
              href={storefrontHref(locale, basePath, giftRecoveryQuery(query))}
            >
              {copy.giftResetFilters}
            </a>
          </>
        )}
        <MarketChoices
          context={context}
          locale={locale}
          copy={copy}
          contextQuery={giftRecoveryQuery(query)}
          path={basePath}
        />
      </>
    );
  else if (context.outcome === "FAILURE")
    body = <p role="status">{copy.contentErrorBody}</p>;
  else if (
    !isMarketAvailable(context, prepared.query.market, prepared.query.currency)
  )
    body = (
      <>
        <p role="status">{copy.marketInvalid}</p>
        <MarketChoices
          context={context}
          locale={locale}
          copy={copy}
          contextQuery={query}
          path={basePath}
        />
      </>
    );
  else
    body = (
      <GiftDirectory
        locale={locale}
        copy={copy}
        query={prepared.query}
        initial={await giftDirectoryRead(prepared.apiQuery)}
        contextQuery={query}
        basePath={basePath}
        headingLevel={headingLevel}
      />
    );
  return (
    <section
      className="storefront-section storefront-directory storefront-gifts"
      id="artist-gifts"
      data-gift-directory-section
    >
      <div className="storefront-section-heading">
        <div>
          <p className="storefront-eyebrow">{copy.giftEyebrow}</p>
          <Heading>{copy.giftTitle}</Heading>
        </div>
        <p>{copy.giftBody}</p>
      </div>
      {artist && (
        <p
          className="gift-directory-recipient"
          data-directory-recipient={artist.id}
        >
          <a
            href={storefrontHref(locale, `/idols/${artist.handle}`, query)}
            lang={artist.localeContext.resolvedLocale}
          >
            {artist.displayName}
          </a>{" "}
          · {artist.acceptingGifts ? copy.artistAccepting : copy.artistPaused}
        </p>
      )}
      {body}
    </section>
  );
}
