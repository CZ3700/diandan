import "server-only";
import type {
  IdolDirectoryResponse,
  PublishedGiftCommerceResponse,
  StorefrontContextResponse,
  StorefrontGiftResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { giftKindLabel } from "./gift-kind-copy";
import { PublishedImage } from "./published-image";
import { GiftPurchase } from "./gift-purchase";
import { GiftDetailRecipient } from "./gift-detail-recipient-section";
import { GiftDetailMarkets } from "./gift-detail-context-section";
import { giftDetailSummary } from "./gift-detail-summary";
import { storefrontHref } from "./navigation";

type Content = Extract<PublishedGiftCommerceResponse, { outcome: "SUCCESS" }>;
type Commerce = Extract<StorefrontGiftResponse, { outcome: "SUCCESS" }>;
/**
 * User request 2026-09-30 (L2-17): the page is the photo, the summary and the purchase.
 * Policies stay in the footer and can be read from the consent at checkout.
 */
export function GiftDetail({
  content,
  commerce,
  context,
  artists,
  locale,
  copy,
  contextQuery,
  variantId,
  marketError = false,
  soleOffer,
}: Readonly<{
  content: Content | Commerce;
  commerce?: Commerce;
  context: Promise<StorefrontContextResponse>;
  artists: Promise<IdolDirectoryResponse>;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  variantId?: string;
  marketError?: boolean;
  /** Reads the offer of an unscoped page when exactly one market is published. */
  soleOffer?: (
    context: StorefrontContextResponse,
  ) => Promise<Commerce | undefined>;
}>) {
  const gift = content.content.view;
  const path = `/gifts/${gift.handle}`;
  const summary = giftDetailSummary(gift, content.content.details);
  const recipient = (
    <GiftDetailRecipient
      {...("wish" in gift && gift.wish ? { wish: gift.wish } : {})}
      artists={artists}
      {...(commerce ? { recipient: commerce.recipient } : {})}
      locale={locale}
      copy={copy}
      contextQuery={contextQuery}
      path={path}
    />
  );
  return (
    <article className="gift-detail" data-gift-detail={gift.id}>
      <div className="gift-breadcrumb">
        <a
          className="storefront-text-link"
          href={storefrontHref(locale, "/gifts", contextQuery)}
        >
          <Icon name="arrow-left" decorative />
          {copy.giftBrowse}
        </a>
      </div>
      {gift.localeContext.schemaVersion === 1 &&
        gift.localeContext.fallbackUsed && (
          <p className="storefront-announcement">{copy.fallbackNotice}</p>
        )}
      <div className="gift-detail-top">
        <section className="gift-detail-gallery" aria-label={copy.giftGallery}>
          <figure className="gift-main-image">
            <PublishedImage
              priority
              media={gift.primaryMedia}
              fallbackLabel={copy.mediaFallback}
              sizes="(max-width: 48rem) 100vw, 55vw"
            />
          </figure>
          {gift.gallery.length > 0 && (
            <div className="gift-additional-images">
              {gift.gallery.map((media, index) => (
                <figure key={`${media.url}:${index}`}>
                  <PublishedImage
                    media={media}
                    fallbackLabel={copy.mediaFallback}
                    sizes="(max-width: 48rem) 45vw, 25vw"
                  />
                </figure>
              ))}
            </div>
          )}
        </section>
        <div className="gift-detail-summary">
          <p className="storefront-eyebrow">
            {content.classification.kind === "CLASSIFIED"
              ? giftKindLabel(copy, content.classification.giftKind)
              : copy.giftEyebrow}
          </p>
          <h1 lang={gift.localeContext.resolvedLocale}>{gift.title}</h1>
          <p className="gift-subtitle" lang={gift.localeContext.resolvedLocale}>
            {gift.subtitle}
          </p>
          {summary.map((text) => (
            <p
              key={text}
              className="gift-short-description"
              lang={gift.localeContext.resolvedLocale}
            >
              {text}
            </p>
          ))}
          {commerce ? (
            <GiftPurchase
              gift={commerce}
              locale={locale}
              copy={copy}
              contextQuery={contextQuery}
              {...(variantId ? { variantId } : {})}
            >
              {recipient}
            </GiftPurchase>
          ) : (
            <>
              {recipient}
              {marketError && <p role="status">{copy.marketInvalid}</p>}
              <GiftDetailMarkets
                context={context}
                locale={locale}
                copy={copy}
                contextQuery={contextQuery}
                path={path}
                {...(soleOffer
                  ? {
                      soleOffer: async (
                        resolved: StorefrontContextResponse,
                      ) => {
                        const offer = await soleOffer(resolved);
                        // The recipient above already reflects the same idol query.
                        return offer ? (
                          <GiftPurchase
                            gift={offer}
                            locale={locale}
                            copy={copy}
                            contextQuery={contextQuery}
                            {...(variantId ? { variantId } : {})}
                          />
                        ) : undefined;
                      },
                    }
                  : {})}
              />
            </>
          )}
          {commerce && (
            <a className="storefront-text-link" href="#gift-markets">
              {copy.region}
            </a>
          )}
        </div>
      </div>
      {commerce && (
        <div className="storefront-section" id="gift-markets">
          <GiftDetailMarkets
            context={context}
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
            path={path}
          />
        </div>
      )}
    </article>
  );
}
