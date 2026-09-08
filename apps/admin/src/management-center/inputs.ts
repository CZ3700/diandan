import type { SupportedLocale } from "@fan-support/contracts";
import {
  currencyDigits,
  parseAmountMinor,
} from "../workspace/gift-editor-model";

function decimalSeparator(locale: SupportedLocale) {
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  );
}
export function parseManagementPrice(
  value: string,
  locale: SupportedLocale,
  currency: string,
): number | null {
  const separator = decimalSeparator(locale);
  if (separator !== "." && value.includes(".")) return null;
  try {
    const amount = parseAmountMinor(value.replace(separator, "."), currency);
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}
export function priceInputValue(
  minor: number,
  locale: SupportedLocale,
  currency: string,
): string {
  const digits = currencyDigits(currency);
  const value = BigInt(minor)
    .toString()
    .padStart(digits + 1, "0");
  return digits === 0
    ? value
    : `${value.slice(0, -digits)}${decimalSeparator(locale)}${value.slice(-digits)}`;
}
export function imageSelectionIssue(
  file: Pick<File, "type" | "size">,
): "imageFormat" | "imageEmpty" | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "imageFormat";
  if (!Number.isSafeInteger(file.size) || file.size < 1) return "imageEmpty";
  return null;
}
