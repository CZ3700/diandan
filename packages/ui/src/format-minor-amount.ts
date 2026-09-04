import type {
  CurrencyCode,
  MinorAmount,
  SupportedLocale,
} from "@fan-support/contracts";

function localizeDigits(digits: string, locale: SupportedLocale) {
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: false,
  });

  return [...digits]
    .map((digit) => formatter.format(Number.parseInt(digit, 10)))
    .join("");
}

export function formatMinorAmount(
  amountMinor: MinorAmount,
  currency: CurrencyCode,
  locale: SupportedLocale,
) {
  const formatter = new Intl.NumberFormat(locale, {
    currency,
    style: "currency",
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  const scale = 10n ** BigInt(fractionDigits);
  const exactAmount = BigInt(amountMinor);
  const integral = exactAmount / scale;
  const fraction = (exactAmount % scale)
    .toString()
    .padStart(fractionDigits, "0");
  const localizedFraction = localizeDigits(fraction, locale);

  return formatter
    .formatToParts(integral)
    .map((part) => (part.type === "fraction" ? localizedFraction : part.value))
    .join("");
}
