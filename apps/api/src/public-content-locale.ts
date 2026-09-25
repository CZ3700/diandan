import {
  DEFAULT_LOCALE,
  type ContentLocaleContext,
  type SupportedLocale,
} from "@fan-support/contracts";

/** Called only after the complete public response schema has validated provenance. */
export function matchesPublicContentLocale(
  context: ContentLocaleContext,
  requested: SupportedLocale,
): boolean {
  if (context.requestedLocale !== requested) return false;
  if (context.schemaVersion === 2)
    return (
      context.publicationMode === "DIRECT_OPERATOR_V1" &&
      context.resolvedLocale === context.sourceLocale &&
      context.fallbackUsed === (requested !== context.sourceLocale)
    );
  return context.fallbackUsed
    ? requested !== DEFAULT_LOCALE && context.resolvedLocale === DEFAULT_LOCALE
    : context.resolvedLocale === requested;
}
