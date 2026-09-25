import {
  checkoutPreflightObservationSchema,
  checkoutPreflightSessionRecordSchema,
  checkoutPreflightViewSchema,
  checkoutSessionViewSchema,
  type CheckoutPreflightObservation,
  type CheckoutPreflightView,
  type CheckoutSessionView,
  type CheckoutTranslationSnapshot,
  type ContentLocaleContext,
} from "@fan-support/contracts";
export {
  selectCheckoutInventory,
  planCheckoutInventory,
} from "./checkout-preflight-inventory.js";

function localeContext(ref: CheckoutTranslationSnapshot): ContentLocaleContext {
  const common = {
    requestedLocale: ref.requestedLocale,
    resolvedLocale: ref.resolvedLocale,
    fallbackUsed: ref.fallbackUsed,
    translationRevision: ref.translationRevisionId,
  };
  return ref.mode === "DAILY"
    ? {
        schemaVersion: 2,
        publicationMode: ref.publicationMode,
        sourceLocale: ref.sourceLocale,
        ...common,
      }
    : { schemaVersion: 1, ...common };
}
function review(observation: CheckoutPreflightObservation) {
  const { consent, quote } = observation;
  const amount = quote.amount;
  return {
    schemaVersion: 1 as const,
    presentationLocale: consent.presentationLocale,
    market: consent.market,
    currency: consent.currency,
    amount: {
      schemaVersion: 1 as const,
      currency: amount.currency,
      subtotalMinor: amount.subtotalMinor,
      taxAmountMinor: amount.taxAmountMinor,
      shippingAmountMinor: amount.shippingAmountMinor,
      feeAmountMinor: amount.feeAmountMinor,
      discountAmountMinor: amount.discountAmountMinor,
      totalAmountMinor: amount.totalAmountMinor,
    },
    lines: consent.lines.map((line, index) => {
      const price = quote.lines[index]!;
      return {
        schemaVersion: 1 as const,
        cartItemId: line.cartItemId,
        idolDisplayName: line.idolDisplayName,
        giftTitle: line.giftTitle,
        giftVariantLabel: line.giftVariantLabel,
        idolLocaleContext: localeContext(line.idolTranslation),
        giftLocaleContext: localeContext(line.giftTranslation),
        quantity: price.quantity,
        unitAmountMinor: price.unitAmountMinor,
        lineSubtotalMinor: price.lineSubtotalMinor,
        taxAmountMinor: price.taxAmountMinor,
        discountAmountMinor: price.discountAmountMinor,
        lineTotalMinor: price.lineTotalMinor,
      };
    }),
    policies: consent.policies.map((policy) => ({
      schemaVersion: 1 as const,
      policyKey: policy.policyKey,
      kind: policy.kind,
      locale: policy.locale,
      policyRevisionId: policy.policyRevisionId,
      policyTranslationRevisionId: policy.policyTranslationRevisionId,
      title: policy.title,
      body: policy.body,
      effectiveAt: policy.effectiveAt,
    })),
  };
}
export function projectCheckoutPreflight(
  input: unknown,
): CheckoutPreflightView {
  const observation = checkoutPreflightObservationSchema.parse(input);
  return checkoutPreflightViewSchema.parse({
    ...review(observation),
    id: observation.id,
    cartVersion: observation.consent.cartVersion,
    expiresAt: observation.expiresAt,
  });
}
export function projectCheckoutSession(input: unknown): CheckoutSessionView {
  const session = checkoutPreflightSessionRecordSchema.parse(input);
  return checkoutSessionViewSchema.parse({
    ...review(session.observation),
    id: session.receipt.checkoutSessionId,
    publicOrderId: session.receipt.publicOrderId,
    status: session.status,
    orderStatus: session.orderStatus,
    paymentStatus: session.paymentStatus,
    expired: session.expired,
    quoteRevision: session.observation.quote.amount.quoteRevision,
    quoteExpiresAt: session.observation.quote.expiresAt,
  });
}
