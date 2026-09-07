"use client";
import { useId, useState } from "react";
import type {
  StorefrontGiftOffer,
  StorefrontGiftResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import { Quantity } from "@fan-support/ui/client";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { giftSelectionHref, selectGiftOffer } from "./gift-selection";

type Gift = Extract<StorefrontGiftResponse, { outcome: "SUCCESS" }>;
export function GiftPurchase({
  gift,
  locale,
  copy,
  contextQuery,
  variantId,
}: Readonly<{
  gift: Gift;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  variantId?: string;
}>) {
  const selected = selectGiftOffer(gift.offers, variantId);
  return (
    <div className="gift-purchase" data-gift-purchase>
      <div className="gift-option-heading">
        <h2>{copy.giftVariant}</h2>
        <p>
          {gift.currency} · {gift.market}
        </p>
      </div>
      <div
        className="gift-variant-options"
        role="group"
        aria-label={copy.giftVariant}
      >
        {gift.content.view.variants.map((variant) => (
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
        />
      ) : (
        <p role="status">{copy.giftNotAvailable}</p>
      )}
      <div className="gift-checkout-state">
        <button
          type="button"
          className="storefront-primary"
          disabled
          data-checkout-unavailable
          aria-describedby="gift-checkout-explanation"
        >
          {copy.giftCheckoutUnavailable}
        </button>
        <p id="gift-checkout-explanation">{copy.giftCheckoutBody}</p>
      </div>
    </div>
  );
}
function Offer({
  offer,
  startingPrice,
  gift,
  locale,
  copy,
}: Readonly<{
  offer: StorefrontGiftOffer;
  startingPrice: boolean;
  gift: Gift;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const id = useId();
  const [quantity, setQuantity] = useState(1);
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
      <p className="gift-stock-label">{label}</p>
      {availabilityMessage}
      {offer.requiresRecipient && (
        <p className="gift-offer-notice">{copy.giftRecipientMissing}</p>
      )}
      {offer.availability !== "UNAVAILABLE" && !offer.requiresRecipient && (
        <Quantity
          id={id}
          label={copy.giftQuantity}
          decreaseLabel={copy.giftQuantityDecrease}
          increaseLabel={copy.giftQuantityIncrease}
          min={1}
          max={offer.maxQuantity}
          value={quantity}
          onValueChange={setQuantity}
        />
      )}
    </div>
  );
}
