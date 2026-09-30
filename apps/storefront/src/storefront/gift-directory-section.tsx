import "server-only";
import {
  giftKindSchema,
  type PublishedIdolView,
  type StorefrontContextResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { GiftBrowseBody } from "./gift-browse-section";
import { GiftNavigationFrame } from "./gift-navigation-frame";
import { giftDirectoryRead } from "./gift-page-reads";
import { prepareGiftQuery } from "./gift-query";
import { GiftDirectory } from "./gift-directory";
import { isMarketAvailable, MarketChoices } from "./commerce-context";
import { giftKindLabel } from "./gift-kind-copy";
import { giftRecoveryQuery } from "./gift-selection";
import { queryString, storefrontHref } from "./navigation";
import { withSoleScope, type CommerceScope } from "./commerce-scope";
import type { StorefrontCopy } from "./copy";

export async function GiftDirectorySection({
  locale,
  copy,
  values,
  context: contextRead,
  basePath = "/gifts",
  headingLevel = 1,
  artist,
  implicitScope,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Readonly<Record<string, string | string[] | undefined>>;
  context: StorefrontContextResponse | Promise<StorefrontContextResponse>;
  basePath?: string;
  headingLevel?: 1 | 2;
  artist?: PublishedIdolView;
  /** The sole published scope an embedding page already confirmed; an explicit choice wins. */
  implicitScope?: CommerceScope;
}>) {
  const explicit =
    values["market"] !== undefined || values["currency"] !== undefined;
  const scope = explicit ? undefined : implicitScope;
  const prepared = prepareGiftQuery(locale, withSoleScope(values, scope));
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const query = queryString(values);
  const kind = giftKindSchema.safeParse(values["kind"]);
  let body;
  const browsing = !explicit && scope === undefined;
  const context = browsing ? undefined : await contextRead;
  if (browsing)
    body = await GiftBrowseBody({
      locale,
      copy,
      values,
      basePath,
      headingLevel,
      pricing: {
        context: contextRead,
        render: (priced) => (
          <GiftDirectory
            locale={locale}
            copy={copy}
            query={priced.query}
            initial={priced.initial}
            contextQuery={priced.contextQuery}
            basePath={basePath}
            headingLevel={headingLevel}
            scope="IMPLICIT"
          />
        ),
      },
    });
  else if (!context) throw new Error("Missing commerce context");
  else if (!prepared.valid)
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
        scope={scope ? "IMPLICIT" : "EXPLICIT"}
      />
    );
  return (
    <section
      className="storefront-section storefront-directory storefront-gifts"
      id="artist-gifts"
      data-gift-directory-section
    >
      {/* User request 2026-09-30 (L2-17): no visible title; the toolbar shows the chosen kind. */}
      <Heading
        className="storefront-sr-only"
        data-gift-kind-heading={kind.data}
      >
        {kind.success ? giftKindLabel(copy, kind.data) : copy.navGifts}
      </Heading>
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
      <GiftNavigationFrame>{body}</GiftNavigationFrame>
    </section>
  );
}
