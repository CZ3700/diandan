import type {
  CurrencyCode,
  MinorAmount,
  SupportedLocale,
} from "@fan-support/contracts";
import { forwardRef, type DataHTMLAttributes } from "react";

import { formatMinorAmount } from "./format-minor-amount.js";

export interface PriceProps extends Omit<
  DataHTMLAttributes<HTMLDataElement>,
  "children" | "lang" | "style" | "value"
> {
  amountMinor: MinorAmount;
  currency: CurrencyCode;
  locale: SupportedLocale;
}

export const Price = forwardRef<HTMLDataElement, PriceProps>(function Price(
  { amountMinor, className, currency, locale, ...props },
  ref,
) {
  const formattedAmount = formatMinorAmount(amountMinor, currency, locale);

  return (
    <data
      {...props}
      ref={ref}
      className={className === undefined ? "fs-price" : `fs-price ${className}`}
      data-currency={currency}
      lang={locale}
      value={String(amountMinor)}
    >
      <bdi>{formattedAmount}</bdi>
    </data>
  );
});
