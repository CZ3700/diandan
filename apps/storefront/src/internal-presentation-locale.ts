import { supportedLocaleSchema } from "@fan-support/contracts";

const INTERNAL_PREFIX = Object.freeze(["", "_internal", "design-foundations"]);

export function createInternalPresentationLocaleUrl(
  currentUrl: URL,
  nextLocale: unknown,
): URL {
  const target = supportedLocaleSchema.safeParse(nextLocale);
  if (!target.success) {
    throw new TypeError("Expected a canonical supported locale");
  }

  const segments = currentUrl.pathname.split("/");
  const hasOptionalTrailingSlash = segments.length === 6 && segments[5] === "";
  const sourceLocale = segments[3];
  const sourceIsPreviewLocale =
    sourceLocale === "en-XA" ||
    supportedLocaleSchema.safeParse(sourceLocale).success;
  if (
    (segments.length !== 5 && !hasOptionalTrailingSlash) ||
    INTERNAL_PREFIX.some((segment, index) => segments[index] !== segment) ||
    !sourceIsPreviewLocale ||
    segments[4] !== "interactions"
  ) {
    throw new TypeError("Expected a gated interaction preview route");
  }

  const destination = new URL(currentUrl.href);
  const destinationSegments = destination.pathname.split("/");
  destinationSegments[3] = target.data;
  destination.pathname = destinationSegments.join("/");
  return destination;
}
