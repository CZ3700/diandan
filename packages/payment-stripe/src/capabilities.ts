import { createHash } from "node:crypto";

/**
 * Stripe minimum charge per presentment currency (docs.stripe.com/currencies, 2026-09-26),
 * in minor units whose exponent matches Stripe's own representation. Currencies whose ISO
 * exponent differs from Stripe's (for example ISK, UGX) are deliberately absent.
 */
const MINIMUM_AMOUNT_MINOR: Readonly<Record<string, number>> = Object.freeze({
  USD: 50,
  CAD: 50,
  MXN: 1000,
  BRL: 50,
  EUR: 50,
  GBP: 30,
  AUD: 50,
  JPY: 50,
  SGD: 50,
  HKD: 400,
  THB: 1000,
});
/** Eight digits is the most conservative Stripe amount limit across payment methods. */
export const MAXIMUM_AMOUNT_MINOR = 99_999_999;

export function minimumAmountMinor(currency: string): number | undefined {
  return Object.hasOwn(MINIMUM_AMOUNT_MINOR, currency)
    ? MINIMUM_AMOUNT_MINOR[currency]
    : undefined;
}

export function supportsAmount(currency: string, amountMinor: number): boolean {
  const minimum = minimumAmountMinor(currency);
  return (
    minimum !== undefined &&
    amountMinor >= minimum &&
    amountMinor <= MAXIMUM_AMOUNT_MINOR
  );
}

/** A stable RFC 9562 version-8 UUID per account and payment method. */
export function capabilityId(
  providerAccountId: string,
  paymentMethod: string,
): string {
  const hex = createHash("sha256")
    .update(
      `stripe-capability:v1:${providerAccountId.toLowerCase()}:${paymentMethod}`,
    )
    .digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
