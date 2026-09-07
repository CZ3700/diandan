import type { SupportedLocale } from "@fan-support/contracts";
import { requireCanonicalLocale } from "./canonical-locale";

const PRESENTATION_LOCALE_COOKIE_NAME = "site_locale";
const PRESENTATION_LOCALE_MAX_AGE_SECONDS = 31_536_000;

function leadingLocale(pathname: string): SupportedLocale {
  const segments = pathname.split("/");
  const candidate = segments[1];
  if (
    segments[0] !== "" ||
    candidate === undefined ||
    segments.some(
      (segment, index) =>
        index > 1 && segment === "" && index !== segments.length - 1,
    )
  ) {
    throw new TypeError("Expected a route with a canonical leading locale");
  }

  return requireCanonicalLocale(
    candidate,
    "Expected a route with a canonical leading locale",
  );
}

export function createPresentationLocaleUrl(
  currentUrl: URL,
  nextLocale: unknown,
): URL {
  const locale = requireCanonicalLocale(nextLocale);
  leadingLocale(currentUrl.pathname);

  const destination = new URL(currentUrl.href);
  const segments = destination.pathname.split("/");
  segments[1] = locale;
  destination.pathname = segments.join("/");
  return destination;
}

export function serializePresentationLocaleCookie(
  locale: unknown,
  options: Readonly<{ secure: boolean }>,
): string {
  const value = requireCanonicalLocale(locale);
  const attributes = [
    `${PRESENTATION_LOCALE_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${PRESENTATION_LOCALE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];

  if (options.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
