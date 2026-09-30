import "server-only";
import type { ReactNode } from "react";
import type {
  StorefrontGiftOffer,
  StorefrontGiftResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import { CART_RUNTIME_MAX_QUANTITY } from "@fan-support/contracts";
import { GiftAdd } from "./gift-add";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { giftSelectionHref, selectGiftOffer } from "./gift-selection-values";

type Gift = Extract<StorefrontGiftResponse, { outcome: "SUCCESS" }>;
export function GiftPurchase({
  gift,
  locale,
  copy,
  contextQuery,
  variantId,
  children,
}: Readonly<{
  gift: Gift;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  variantId?: string;
  children?: ReactNode;
}>) {
  const selected = selectGiftOffer(gift.offers, variantId);
  const choices = (
    <>
      {children}
      <VariantOptions
        gift={gift}
        selected={selected}
        locale={locale}
        copy={copy}
        contextQuery={contextQuery}
      />
    </>
  );
  return (
    <div className="gift-purchase" data-gift-purchase>
      {selected ? (
        <Offer
          key={`${selected.giftVariantId}:${selected.maxQuantity}:${gift.recipient.kind}`}
          offer={selected}
          startingPrice={
            variantId === undefined &&
            selected.requiresRecipient &&
            selected.availability !== "UNAVAILABLE"
          }
          gift={gift}
          locale={locale}
          copy={copy}
        >
          {choices}
        </Offer>
      ) : (
        <>
          {choices}
          <p role="status">{copy.giftNotAvailable}</p>
        </>
      )}
    </div>
  );
}

function VariantOptions({
  gift,
  selected,
  locale,
  copy,
  contextQuery,
}: Readonly<{
  gift: Gift;
  selected: StorefrontGiftOffer | undefined;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
}>) {
  const variants = gift.content.view.variants;
  const soleVariant = variants.length === 1 ? variants[0] : undefined;
  const soleSelected =
    soleVariant && selected?.giftVariantId === soleVariant.id;
  return (
    <>
      <div className="gift-option-heading">
        <h2>{copy.giftVariant}</h2>
        <p>
          {gift.currency} · {gift.market}
        </p>
      </div>
      {soleSelected ? (
        <p
          className="gift-single-variant"
          data-gift-selected-variant={soleVariant.id}
          lang={gift.content.view.localeContext.resolvedLocale}
        >
          {soleVariant.label}
        </p>
      ) : (
        <div
          className="gift-variant-options"
          role="group"
          aria-label={copy.giftVariant}
        >
          {variants.map((variant) => (
            <a
              key={variant.id}
              data-gift-variant={variant.id}
              href={giftSelectionHref(
                locale,
                `/gifts/${gift.content.view.handle}`,
                contextQuery,
                { variant: variant.id },
              )}
              aria-current={
                selected?.giftVariantId === variant.id ? "true" : undefined
              }
            >
              <span lang={gift.content.view.localeContext.resolvedLocale}>
                {variant.label}
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function Offer({
  offer,
  startingPrice,
  gift,
  locale,
  copy,
  children,
}: Readonly<{
  offer: StorefrontGiftOffer;
  startingPrice: boolean;
  children: ReactNode;
  gift: Gift;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const policyLabels = {
    TRACKED: copy.giftTracked,
    PREORDER: copy.giftPreorder,
    PROCURE_ON_DEMAND: copy.giftProcureOnDemand,
  };
  const label = policyLabels[offer.stock.kind];
  let unavailable = copy.giftNotAvailable;
  if (offer.reason === "OUT_OF_STOCK") unavailable = copy.giftSoldOut;
  else if (offer.reason === "NOT_ELIGIBLE")
    unavailable = copy.giftRecipientIneligible;
  else if (offer.reason === "RECIPIENT_UNAVAILABLE")
    unavailable =
      gift.recipient.kind === "PUBLISHED"
        ? copy.artistPaused
        : copy.giftRecipientUnavailable;
  let availabilityMessage = <p>{copy.giftProcureBody}</p>;
  if (offer.availability === "UNAVAILABLE")
    availabilityMessage = (
      <p className="gift-offer-notice" role="status">
        {unavailable}
      </p>
    );
  else if (offer.stock.kind === "TRACKED")
    availabilityMessage = (
      <p data-stock-remaining>
        {formatStorefrontMessage(copy, "giftStockRemaining", locale, {
          count: offer.stock.availableQuantity,
        })}
      </p>
    );
  else if (offer.stock.kind === "PREORDER")
    availabilityMessage = <p>{copy.giftPreorderBody}</p>;
  return (
    <div
      data-gift-offer
      data-availability={offer.availability}
      data-inventory-policy={offer.stock.kind}
    >
      {offer.price !== null ? (
        <div className="gift-detail-price">
          {startingPrice && <span>{copy.giftPriceStartingAt}</span>}
          <Price
            locale={locale}
            currency={gift.currency}
            amountMinor={offer.price.unitAmountMinor}
          />
        </div>
      ) : null}
      {children}
      <p className="gift-stock-label">{label}</p>
      {availabilityMessage}
      {offer.requiresRecipient && (
        <p className="gift-offer-notice">{copy.giftRecipientMissing}</p>
      )}
      {offer.availability !== "UNAVAILABLE" &&
        !offer.requiresRecipient &&
        offer.price &&
        gift.recipient.kind === "PUBLISHED" && (
          <GiftAdd
            {...("wish" in gift.content.view && gift.content.view.wish
              ? { wish: true }
              : {})}
            key={`${offer.giftVariantId}:${offer.maxQuantity}:${gift.recipient.idol.id}`}
            locale={locale}
            copy={copy}
            giftId={gift.content.view.id}
            giftVariantId={offer.giftVariantId}
            idolId={gift.recipient.idol.id}
            observedPriceId={offer.price.priceId}
            market={gift.market}
            currency={gift.currency}
            max={Math.min(offer.maxQuantity, CART_RUNTIME_MAX_QUANTITY)}
          />
        )}
    </div>
  );
}
