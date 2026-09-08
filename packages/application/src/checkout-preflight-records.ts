import {
  checkoutPreflightCurrentSchema,
  checkoutPreflightObservationSchema,
  checkoutPreflightSessionRecordSchema,
  checkoutSessionIdSchema,
  checkoutPreflightIdSchema,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
  type CheckoutPreflightCreateCommand,
  type CheckoutPreflightObservation,
  type SupportedLocale,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import type { CheckoutPreflightRepositories } from "@fan-support/persistence-port";
import { checkoutConsentHash } from "./checkout-observation.js";
import { rejectCheckout } from "./checkout-transaction.js";

export async function readCheckoutObservation(
  repos: CheckoutPreflightRepositories,
  cart: CartRuntimeHeader,
  context: CartRuntimeRequestContext,
  id: string,
) {
  const stored = await repos.checkoutPreflight.readPreflight({
    schemaVersion: 1,
    accesses: context.accesses,
    cartId: cart.id,
    preflightId: checkoutPreflightIdSchema.parse(id),
  });
  if (!stored) return rejectCheckout("PREFLIGHT_NOT_FOUND");
  const observation = checkoutPreflightObservationSchema.parse(stored);
  if (
    observation.id.toLowerCase() !== id.toLowerCase() ||
    observation.consent.cartId !== cart.id ||
    observation.consentHash !== checkoutConsentHash(observation.consent)
  )
    return rejectCheckout("CONTENT_UNAVAILABLE");
  return observation;
}
export async function readCheckoutCurrent(
  repos: CheckoutPreflightRepositories,
  cart: CartRuntimeHeader,
  context: CartRuntimeRequestContext,
  locale: SupportedLocale,
) {
  const current = checkoutPreflightCurrentSchema.parse(
    await repos.checkoutPreflight.loadCurrent({
      schemaVersion: 1,
      accesses: context.accesses,
      cartId: cart.id,
      expectedCartVersion: cart.version,
      presentationLocale: locale,
    }),
  );
  if (
    current.cart.id !== cart.id ||
    current.cart.version !== cart.version ||
    current.consent.presentationLocale !== locale ||
    current.cart.market !== cart.market ||
    current.cart.currency !== cart.currency ||
    current.cart.status !== "ACTIVE" ||
    current.cart.expired
  )
    return rejectCheckout("CONTENT_UNAVAILABLE");
  return current;
}
export function requireCheckoutConsent(
  observation: CheckoutPreflightObservation,
  command: CheckoutPreflightCreateCommand,
) {
  if (observation.consent.cartVersion !== command.expectedCartVersion)
    return rejectCheckout("VERSION_CONFLICT");
  if (
    command.policyAcceptances.length !== observation.consent.policies.length ||
    observation.consent.policies.some(
      (policy) =>
        !command.policyAcceptances.some(
          (accepted) =>
            accepted.policyKey === policy.policyKey &&
            accepted.policyRevisionId.toLowerCase() ===
              policy.policyRevisionId.toLowerCase() &&
            accepted.policyTranslationRevisionId.toLowerCase() ===
              policy.policyTranslationRevisionId.toLowerCase(),
        ),
    )
  )
    return rejectCheckout("POLICY_ACCEPTANCE_REQUIRED");
}
export function requireUnchangedCheckout(
  observation: CheckoutPreflightObservation,
  current: Awaited<ReturnType<typeof readCheckoutCurrent>>,
) {
  if (Date.parse(current.evaluatedAt) >= Date.parse(observation.expiresAt))
    return rejectCheckout("PREFLIGHT_EXPIRED");
  if (
    canonicalPublicationValue(current.consent.policies) !==
    canonicalPublicationValue(observation.consent.policies)
  )
    return rejectCheckout("POLICY_CHANGED");
  if (checkoutConsentHash(current.consent) !== observation.consentHash)
    return rejectCheckout("PREFLIGHT_CHANGED");
}
export async function readCheckoutSession(
  repos: CheckoutPreflightRepositories,
  cart: CartRuntimeHeader,
  context: CartRuntimeRequestContext,
  id: string,
) {
  const stored = await repos.checkoutPreflight.readSession({
    schemaVersion: 1,
    accesses: context.accesses,
    cartId: cart.id,
    checkoutSessionId: checkoutSessionIdSchema.parse(id),
  });
  if (!stored) return rejectCheckout("CHECKOUT_NOT_FOUND");
  const record = checkoutPreflightSessionRecordSchema.parse(stored);
  if (
    record.receipt.cartId !== cart.id ||
    record.receipt.checkoutSessionId.toLowerCase() !== id.toLowerCase() ||
    record.observation.consent.cartId !== cart.id ||
    record.receipt.preflightId !== record.observation.id ||
    record.observation.consentHash !==
      checkoutConsentHash(record.observation.consent)
  )
    return rejectCheckout("CONTENT_UNAVAILABLE");
  return record;
}
