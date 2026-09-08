import type {
  CheckoutPreflightView,
  CheckoutSessionView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { PolicyBody } from "./gift-content";
export function CheckoutReview({
  review,
  locale,
  copy,
}: Readonly<{
  review: CheckoutPreflightView | CheckoutSessionView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const amount = review.amount;
  return (
    <div className="checkout-review" data-checkout-review>
      <h2>{copy.checkoutReview}</h2>
      <ol className="checkout-lines">
        {review.lines.map((line) => (
          <li key={line.cartItemId} data-checkout-line={line.cartItemId}>
            <p
              className="checkout-artist"
              lang={line.idolLocaleContext.resolvedLocale}
            >
              {line.idolDisplayName}
            </p>
            <h3 lang={line.giftLocaleContext.resolvedLocale}>
              {line.giftTitle}
            </h3>
            <p lang={line.giftLocaleContext.resolvedLocale}>
              {line.giftVariantLabel}
            </p>
            <div className="checkout-line-price">
              <span>
                {copy.checkoutQuantity}:{" "}
                {new Intl.NumberFormat(locale).format(line.quantity)}
              </span>
              <Price
                locale={locale}
                currency={review.currency}
                amountMinor={line.lineTotalMinor}
              />
            </div>
          </li>
        ))}
      </ol>
      <dl className="checkout-totals">
        {(
          [
            [copy.checkoutSubtotal, amount.subtotalMinor],
            [copy.checkoutTax, amount.taxAmountMinor],
            [copy.checkoutShipping, amount.shippingAmountMinor],
            [copy.checkoutFees, amount.feeAmountMinor],
            [copy.checkoutDiscount, amount.discountAmountMinor],
          ] as const
        )
          .filter(([, value], index) => index === 0 || value > 0)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <Price
                  locale={locale}
                  currency={review.currency}
                  amountMinor={value}
                />
              </dd>
            </div>
          ))}
        <div className="checkout-total">
          <dt>{copy.cartTotal}</dt>
          <dd data-checkout-total>
            <Price
              locale={locale}
              currency={review.currency}
              amountMinor={amount.totalAmountMinor}
            />
          </dd>
        </div>
      </dl>
      <div className="checkout-policies">
        {review.policies.map((policy) => (
          <details key={policy.policyKey} lang={policy.locale}>
            <summary>{policy.title}</summary>
            <PolicyBody body={policy.body} />
          </details>
        ))}
      </div>
    </div>
  );
}
