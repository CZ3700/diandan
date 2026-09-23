import type {
  GiftDirectoryResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Price, Status } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { giftDetailHref } from "./gift-query";
import { PublishedImage } from "./published-image";

type DirectoryItem = Extract<
  GiftDirectoryResponse,
  { outcome: "SUCCESS" }
>["items"][number];

export function GiftDirectoryCard({
  item,
  locale,
  copy,
  contextQuery,
  headingLevel,
}: Readonly<{
  item: DirectoryItem;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  headingLevel: 2 | 3;
}>) {
  const { gift, offer } = item;
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
            sizes="(max-width: 48rem) 45vw, (max-width: 90rem) 30vw, 432px"
          />
        </div>
        <div className="gift-directory-card__body">
          <Heading lang={gift.localeContext.resolvedLocale}>
            {gift.title}
          </Heading>
          {offer.priceMinor === null ? (
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
