import "server-only";
import type {
  IdolDirectoryResponse,
  PublishedGiftCommerceResponse,
  StorefrontContextResponse,
  StorefrontGiftResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { PublishedImage } from "./published-image";
import { GiftDescription } from "./gift-content";
import { GiftPurchase } from "./gift-purchase";
import { GiftDetailRecipient } from "./gift-detail-recipient-section";
import {
  GiftDetailMarkets,
  GiftDetailPolicyLinks,
} from "./gift-detail-context-section";
import { storefrontHref } from "./navigation";

type Content = Extract<PublishedGiftCommerceResponse, { outcome: "SUCCESS" }>;
type Commerce = Extract<StorefrontGiftResponse, { outcome: "SUCCESS" }>;
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
}>) {
  const gift = content.content.view;
  const kindLabels = {
    VIRTUAL: copy.giftKindVirtual,
    PHYSICAL: copy.giftKindPhysical,
    WISH: copy.giftKindWish,
    MERCHANDISE: copy.giftKindMerchandise,
    OTHER: copy.giftKindOther,
  };
  const path = `/gifts/${gift.handle}`;
  const estimate = gift.deliveryEstimate;
  const recipient = (
    <GiftDetailRecipient
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
              ? kindLabels[content.classification.giftKind]
              : copy.giftEyebrow}
          </p>
          <h1 lang={gift.localeContext.resolvedLocale}>{gift.title}</h1>
          <p className="gift-subtitle" lang={gift.localeContext.resolvedLocale}>
            {gift.subtitle}
          </p>
          {gift.shortDescription.trim() !== gift.subtitle?.trim() && (
            <p
              className="gift-short-description"
              lang={gift.localeContext.resolvedLocale}
            >
              {gift.shortDescription}
            </p>
          )}
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
      <section
        className="storefront-section gift-detail-information"
        aria-labelledby="gift-information-title"
      >
        <div>
          <h2 id="gift-information-title">{copy.giftDetails}</h2>
          <p>{copy.giftHandover}</p>
        </div>
        <div lang={gift.localeContext.resolvedLocale}>
          <GiftDescription details={content.content.details} copy={copy} />
        </div>
      </section>
      <section
        className="storefront-section gift-detail-information"
        aria-labelledby="gift-delivery-title"
      >
        <h2 id="gift-delivery-title">{copy.giftDelivery}</h2>
        <div className="gift-delivery-copy">
          {gift.fulfillmentDescription && (
            <p lang={gift.localeContext.resolvedLocale}>
              {gift.fulfillmentDescription}
            </p>
          )}
          {estimate && (
            <p>
              {formatStorefrontMessage(
                copy,
                estimate.unit === "WEEK" ? "giftEstimateWeeks" : "giftEstimate",
                locale,
                { minimum: estimate.minimum, maximum: estimate.maximum },
              )}
            </p>
          )}
          {gift.safetyNotice && (
            <p lang={gift.localeContext.resolvedLocale}>{gift.safetyNotice}</p>
          )}
          <GiftDetailPolicyLinks
            labelledBy="gift-delivery-title"
            context={context}
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
          />
        </div>
      </section>
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
