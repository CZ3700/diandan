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
import { GiftRecipientPicker } from "./gift-recipient";
import { MarketChoices, PolicyLinks } from "./commerce-context";
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
  context: StorefrontContextResponse;
  artists: IdolDirectoryResponse;
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
  const recipientId = new URLSearchParams(contextQuery).get("idol");
  const selectedArtist =
    artists.outcome === "SUCCESS" && recipientId
      ? artists.items.find(
          (artist) => artist.id.toLowerCase() === recipientId.toLowerCase(),
        )
      : undefined;
  const recipient =
    commerce?.recipient ??
    (selectedArtist
      ? { kind: "PUBLISHED" as const, idol: selectedArtist }
      : recipientId
        ? { kind: "UNAVAILABLE" as const, idolId: recipientId }
        : { kind: "NONE" as const });
  const path = `/gifts/${gift.handle}`;
  const estimate = gift.deliveryEstimate;
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
      {gift.localeContext.fallbackUsed && (
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
          <section
            className="gift-recipient-summary"
            aria-labelledby="gift-recipient-title"
          >
            <h2 id="gift-recipient-title">{copy.giftRecipient}</h2>
            {recipient?.kind === "PUBLISHED" ? (
              <div
                className="gift-selected-recipient"
                data-selected-recipient={recipient.idol.id}
              >
                <PublishedImage
                  media={recipient.idol.portrait}
                  fallbackLabel={copy.mediaFallback}
                  sizes="64px"
                />
                <div>
                  <a
                    lang={recipient.idol.localeContext.resolvedLocale}
                    href={storefrontHref(
                      locale,
                      `/idols/${recipient.idol.handle}`,
                      contextQuery,
                    )}
                  >
                    {recipient.idol.displayName}
                  </a>
                  <p>
                    {recipient.idol.acceptingGifts
                      ? copy.artistAccepting
                      : copy.artistPaused}
                  </p>
                </div>
              </div>
            ) : (
              <p
                role={recipient?.kind === "UNAVAILABLE" ? "status" : undefined}
              >
                {recipient?.kind === "UNAVAILABLE"
                  ? copy.giftRecipientUnavailable
                  : copy.giftRecipientMissing}
              </p>
            )}
            <GiftRecipientPicker
              key={`${locale}:${contextQuery}`}
              locale={locale}
              copy={copy}
              contextQuery={contextQuery}
              path={path}
              initial={artists}
              selected={recipient?.kind === "PUBLISHED"}
            />
          </section>
          {commerce ? (
            <GiftPurchase
              gift={commerce}
              locale={locale}
              copy={copy}
              contextQuery={contextQuery}
              {...(variantId ? { variantId } : {})}
            />
          ) : (
            <>
              {marketError && <p role="status">{copy.marketInvalid}</p>}
              <MarketChoices
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
          <p lang={gift.localeContext.resolvedLocale}>
            {gift.fulfillmentDescription}
          </p>
          <p>
            {formatStorefrontMessage(
              copy,
              estimate.unit === "WEEK" ? "giftEstimateWeeks" : "giftEstimate",
              locale,
              { minimum: estimate.minimum, maximum: estimate.maximum },
            )}
          </p>
          {gift.safetyNotice && (
            <p lang={gift.localeContext.resolvedLocale}>{gift.safetyNotice}</p>
          )}
          <PolicyLinks
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
          <MarketChoices
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
