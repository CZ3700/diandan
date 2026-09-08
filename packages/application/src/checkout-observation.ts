import {
  checkoutPreflightCurrentSchema,
  checkoutPreflightObservationSchema,
  checkoutPreflightConsentSchema,
  checkoutQuoteSchema,
  type CheckoutPreflightConsent,
} from "@fan-support/contracts";
import {
  calculateLineAmounts,
  calculateOrderAmounts,
} from "@fan-support/domain";
import { hashPublicationValue } from "@fan-support/content";
import { rejectCheckout } from "./checkout-transaction.js";

export const checkoutConsentHash = (value: CheckoutPreflightConsent) =>
  hashPublicationValue(
    "fan-support.checkout-consent.v1",
    checkoutPreflightConsentSchema.parse(value),
  );
/** Calculate from canonical minor-unit facts; no browser amount can enter this builder. */
export function createCheckoutObservation(
  input: unknown,
  preflightId: string,
  quoteId: string,
  ttlMs: number,
) {
  const current = checkoutPreflightCurrentSchema.parse(input);
  const expiresMs = Math.min(
    Date.parse(current.evaluatedAt) + ttlMs,
    Date.parse(current.cart.expiresAt),
  );
  if (expiresMs <= Date.parse(current.evaluatedAt))
    return rejectCheckout("CART_EXPIRED");
  const expiresAt = new Date(expiresMs).toISOString();
  const lines = current.consent.lines.map((line) => {
    if (line.observedPriceId.toLowerCase() !== line.priceId.toLowerCase())
      return rejectCheckout("PRICE_CHANGED");
    const calculated = calculateLineAmounts({
      schemaVersion: 1,
      unitAmountMinor: line.unitAmountMinor,
      quantity: line.quantity,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
    });
    if (calculated.kind !== "CALCULATED")
      return rejectCheckout("AMOUNT_OVERFLOW");
    return {
      schemaVersion: 1,
      cartItemId: line.cartItemId,
      giftVariantId: line.giftVariantId,
      priceId: line.priceId,
      priceRevision: line.priceRevision,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      lineSubtotalMinor: calculated.lineSubtotalMinor,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      lineTotalMinor: calculated.lineTotalMinor,
    };
  });
  const calculated = calculateOrderAmounts({
    schemaVersion: 1,
    currency: current.consent.currency,
    lines: lines.map((line) => ({
      ...line,
      currency: current.consent.currency,
    })),
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
  });
  if (calculated.kind !== "CALCULATED")
    return rejectCheckout("AMOUNT_OVERFLOW");
  const quote = checkoutQuoteSchema.parse({
    schemaVersion: 1,
    id: quoteId,
    cartVersion: current.consent.cartVersion,
    expiresAt,
    lines,
    amount: {
      schemaVersion: 1,
      subtotalMinor: calculated.subtotalMinor,
      taxAmountMinor: calculated.taxAmountMinor,
      shippingAmountMinor: calculated.shippingAmountMinor,
      feeAmountMinor: calculated.feeAmountMinor,
      discountAmountMinor: calculated.discountAmountMinor,
      totalAmountMinor: calculated.totalAmountMinor,
      market: current.consent.market,
      currency: current.consent.currency,
      quoteRevision: 1,
      quoteExpiresAt: expiresAt,
    },
  });
  return checkoutPreflightObservationSchema.parse({
    schemaVersion: 1,
    id: preflightId,
    consentHash: checkoutConsentHash(current.consent),
    consent: current.consent,
    quote,
    createdAt: current.evaluatedAt,
    expiresAt,
  });
}
