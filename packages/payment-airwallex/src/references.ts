/**
 * Airwallex object IDs use `_`, which platform provider references exclude. Airwallex IDs never
 * contain `.`, so swapping the two characters is a lossless, reversible mapping. Dispute and
 * event identifiers have changed shape across API versions, so only their alphabet is checked.
 */
export const AIRWALLEX_OBJECT_PREFIXES = Object.freeze({
  paymentIntent: ["int_"],
  refund: ["rfd_"],
  dispute: [""],
  event: [""],
} as const);
export type AirwallexObjectKind = keyof typeof AIRWALLEX_OBJECT_PREFIXES;

const AIRWALLEX_ID = /^[A-Za-z0-9][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)*$/u;
const PLATFORM_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*$/u;
const MAX_LENGTH = 255;

export function isAirwallexId(
  value: unknown,
  kind: AirwallexObjectKind,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LENGTH &&
    AIRWALLEX_ID.test(value) &&
    AIRWALLEX_OBJECT_PREFIXES[kind].some((prefix) => value.startsWith(prefix))
  );
}

export function toPlatformReference(
  airwallexId: string,
  kind: AirwallexObjectKind,
): string {
  if (!isAirwallexId(airwallexId, kind))
    throw new TypeError("Unexpected Airwallex object identifier");
  return airwallexId.replaceAll("_", ".");
}

export function fromPlatformReference(
  reference: string,
  kind: AirwallexObjectKind,
): string {
  if (!PLATFORM_REFERENCE.test(reference))
    throw new TypeError("Unexpected Airwallex platform reference");
  const airwallexId = reference.replaceAll(".", "_");
  if (!isAirwallexId(airwallexId, kind))
    throw new TypeError("Unexpected Airwallex platform reference");
  return airwallexId;
}
