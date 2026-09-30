import type {
  CatalogDirectoryOffer,
  PublishedGiftView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Price, Status } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { giftKindLabel, isBrowsableGiftKind } from "./gift-kind-copy";
import { giftDetailHref } from "./gift-query";
import { PublishedImage } from "./published-image";
import { wishStatusLabel } from "./wish-status";

/**
 * One directory card for every gift list: kind, name, a clamped summary and the price.
 * The full summary is on the gift's own page.
 */
export function GiftCard({
  gift,
  offer,
  locale,
  copy,
  contextQuery,
  headingLevel,
  pricePending = false,
}: Readonly<{
  gift: PublishedGiftView;
  offer?: CatalogDirectoryOffer | undefined;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  headingLevel: 2 | 3;
  /** Holds the price line while a single market's offers are still being read. */
  pricePending?: boolean;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <li className="gift-directory-card" data-gift-card={gift.id}>
      <a
        href={giftDetailHref(locale, gift.handle, contextQuery)}
        data-gift-link={gift.id}
      >
        <div className="gift-directory-card__media">
          <PublishedImage
            media={gift.primaryMedia}
            fallbackLabel={copy.mediaFallback}
            sizes="auto, (max-width: 48rem) 100vw, (max-width: 90rem) 50vw, 720px"
          />
        </div>
        <div className="gift-directory-card__body">
          {isBrowsableGiftKind(gift.giftKind) && (
            <p className="gift-directory-card__kind">
              {giftKindLabel(copy, gift.giftKind)}
            </p>
          )}
          <Heading lang={gift.localeContext.resolvedLocale}>
            {gift.title}
          </Heading>
          {"wish" in gift && gift.wish && (
            <p className="wish-card-status" data-wish-status={gift.wish.status}>
              {wishStatusLabel(gift.wish.status, copy)}
            </p>
          )}
          {gift.shortDescription.trim() !== "" && (
            <p
              className="gift-directory-card__summary"
              lang={gift.localeContext.resolvedLocale}
            >
              {gift.shortDescription}
            </p>
          )}
          {offer ? (
            offer.priceMinor === null ? (
              <Status>{copy.giftNotAvailable}</Status>
            ) : (
              <p className="gift-directory-card__price">
                <span>{copy.giftPriceStartingAt}</span>{" "}
                <Price
                  amountMinor={offer.priceMinor}
                  currency={offer.currency}
                  locale={locale}
                />
              </p>
            )
          ) : (
            pricePending && (
              <p
                className="gift-directory-card__pending"
                data-gift-price-pending
                aria-hidden="true"
              >
                <span />
              </p>
            )
          )}
          {gift.localeContext.schemaVersion === 1 &&
            gift.localeContext.fallbackUsed && (
              <p className="gift-directory-card__fallback">
                {copy.fallbackNotice}
              </p>
            )}
        </div>
      </a>
    </li>
  );
}
