import {
  minorAmountSchema,
  currencySchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
export function FinanceMoney({
  amount,
  currency,
  locale,
}: {
  amount: number;
  currency: string;
  locale: SupportedLocale;
}) {
  return (
    <Price
      amountMinor={minorAmountSchema.parse(amount)}
      currency={currencySchema.parse(currency)}
      locale={locale}
    />
  );
}
