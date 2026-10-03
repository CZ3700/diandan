import { createHash } from "node:crypto";

/**
 * Airwallex amounts are decimals in major units. Only currencies whose decimal precision was
 * checked against docs/payments/reference/supported-currencies (2026-09-26) are listed; the
 * platform's minor units use the same ISO 4217 exponents.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, 0 | 2>> = Object.freeze({
  USD: 2,
  CAD: 2,
  MXN: 2,
  BRL: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  JPY: 0,
  SGD: 2,
  HKD: 2,
  THB: 2,
});
/** Airwallex publishes no per-currency floor; business minimums live in payment rules. */
export const MINIMUM_AMOUNT_MINOR = 1;
export const MAXIMUM_AMOUNT_MINOR = 99_999_999;

export function currencyExponent(currency: string): 0 | 2 | undefined {
  return Object.hasOwn(CURRENCY_EXPONENTS, currency)
    ? CURRENCY_EXPONENTS[currency]
    : undefined;
}

export function supportsAmount(currency: string, amountMinor: number): boolean {
  return (
    currencyExponent(currency) !== undefined &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor >= MINIMUM_AMOUNT_MINOR &&
    amountMinor <= MAXIMUM_AMOUNT_MINOR
  );
}

/** Integer division by a power of ten serializes to the shortest exact decimal in JSON. */
export function toMajorAmount(currency: string, amountMinor: number): number {
  const exponent = currencyExponent(currency);
  if (exponent === undefined || !Number.isSafeInteger(amountMinor))
    throw new TypeError("Unsupported Airwallex amount");
  return amountMinor / 10 ** exponent;
}

/** A provider amount that is not an exact number of minor units is malformed, never rounded. */
export function toMinorAmount(
  currency: string,
  amount: unknown,
): number | undefined {
  const exponent = currencyExponent(currency);
  if (
    exponent === undefined ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0
  )
    return undefined;
  const scaled = amount * 10 ** exponent;
  const minor = Math.round(scaled);
  return Number.isSafeInteger(minor) && Math.abs(scaled - minor) < 1e-6
    ? minor
    : undefined;
}

/** A stable RFC 9562 version-8 UUID per account and payment method. */
export function capabilityId(
  providerAccountId: string,
  paymentMethod: string,
): string {
  const hex = createHash("sha256")
    .update(
      `airwallex-capability:v1:${providerAccountId.toLowerCase()}:${paymentMethod}`,
    )
    .digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
