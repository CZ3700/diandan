import {
  parseSupportedLocale,
  type SupportedLocale,
} from "@fan-support/contracts";

/** Exact canonical membership; normalization must never rewrite public routes. */
export function requireCanonicalLocale(
  value: unknown,
  message = "Expected a canonical supported locale",
): SupportedLocale {
  const parsed = parseSupportedLocale(value);
  if (parsed === undefined || parsed !== value) throw new TypeError(message);
  return parsed;
}
