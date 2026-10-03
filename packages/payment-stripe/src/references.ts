/**
 * Stripe object IDs use `_`, which platform provider references exclude. Stripe IDs never
 * contain `.`, so swapping the two characters is a lossless, reversible mapping.
 */
export const STRIPE_OBJECT_PREFIXES = Object.freeze({
  session: ["cs_test_", "cs_live_"],
  paymentIntent: ["pi_"],
  charge: ["ch_", "py_"],
  refund: ["re_", "pyr_"],
  dispute: ["dp_", "du_"],
  event: ["evt_"],
} as const);
export type StripeObjectKind = keyof typeof STRIPE_OBJECT_PREFIXES;

const STRIPE_ID = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/u;
const PLATFORM_REFERENCE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/u;
const MAX_LENGTH = 255;

export function isStripeId(value: unknown, kind: StripeObjectKind): boolean {
  return (
    typeof value === "string" &&
    value.length <= MAX_LENGTH &&
    STRIPE_ID.test(value) &&
    STRIPE_OBJECT_PREFIXES[kind].some((prefix) => value.startsWith(prefix))
  );
}

export function toPlatformReference(
  stripeId: string,
  kind: StripeObjectKind,
): string {
  if (!isStripeId(stripeId, kind))
    throw new TypeError("Unexpected Stripe object identifier");
  return stripeId.replaceAll("_", ".");
}

export function fromPlatformReference(
  reference: string,
  kind: StripeObjectKind,
): string {
  if (!PLATFORM_REFERENCE.test(reference))
    throw new TypeError("Unexpected Stripe platform reference");
  const stripeId = reference.replaceAll(".", "_");
  if (!isStripeId(stripeId, kind))
    throw new TypeError("Unexpected Stripe platform reference");
  return stripeId;
}
