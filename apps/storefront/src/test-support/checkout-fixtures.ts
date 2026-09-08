import {
  checkoutPreflightViewSchema,
  checkoutSessionViewSchema,
  paymentRuntimeAttemptViewSchema,
} from "@fan-support/contracts";
export const checkoutTestId = "10000000-0000-4000-8000-000000000001";
export const attemptTestId = "10000000-0000-4000-8000-000000000002";
const localeContext = {
  schemaVersion: 1,
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
  translationRevision: checkoutTestId,
};
export const reviewFixture = checkoutPreflightViewSchema.parse({
  schemaVersion: 1,
  id: checkoutTestId,
  cartVersion: 2,
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  expiresAt: "2026-09-10T00:00:00Z",
  amount: {
    schemaVersion: 1,
    currency: "USD",
    subtotalMinor: 1500,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    totalAmountMinor: 1500,
  },
  lines: [
    {
      schemaVersion: 1,
      cartItemId: checkoutTestId,
      idolDisplayName: "Artist",
      giftTitle: "Gift",
      giftVariantLabel: "Standard",
      idolLocaleContext: localeContext,
      giftLocaleContext: localeContext,
      quantity: 1,
      unitAmountMinor: 1500,
      lineSubtotalMinor: 1500,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      lineTotalMinor: 1500,
    },
  ],
  policies: [
    {
      schemaVersion: 1,
      policyKey: "terms",
      kind: "TERMS",
      locale: "en",
      policyRevisionId: checkoutTestId,
      policyTranslationRevisionId: checkoutTestId,
      title: "Terms",
      body: "<p>TEST terms</p>",
      effectiveAt: "2026-09-08T00:00:00Z",
    },
  ],
});
const review = {
  schemaVersion: reviewFixture.schemaVersion,
  id: reviewFixture.id,
  presentationLocale: reviewFixture.presentationLocale,
  market: reviewFixture.market,
  currency: reviewFixture.currency,
  amount: reviewFixture.amount,
  lines: reviewFixture.lines,
  policies: reviewFixture.policies,
};
export const checkoutFixture = checkoutSessionViewSchema.parse({
  ...review,
  publicOrderId: checkoutTestId,
  status: "READY",
  orderStatus: "PENDING_PAYMENT",
  paymentStatus: "UNPAID",
  expired: false,
  quoteRevision: 1,
  quoteExpiresAt: "2026-09-10T00:00:00Z",
});
export const attemptFixture = paymentRuntimeAttemptViewSchema.parse({
  schemaVersion: 1,
  id: attemptTestId,
  checkoutSessionId: checkoutTestId,
  version: 1,
  environment: "TEST",
  status: "UNKNOWN",
  requestedLocale: "en",
  providerLocale: "en",
  providerLocaleFallbackUsed: false,
  recovery: "RECONCILE_REQUIRED",
  canRetry: false,
  actionExpired: false,
  updatedAt: "2026-09-09T00:00:00Z",
});
export const currentFixture = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "CURRENT",
  checkout: checkoutFixture,
  attempt: attemptFixture,
} as const;
