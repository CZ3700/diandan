import {
  supportedLocaleSchema,
  type SupportedLocale,
} from "@fan-support/contracts";

const PRESENTATION_LOCALE_COOKIE_NAME = "site_locale";
const PRESENTATION_LOCALE_MAX_AGE_SECONDS = 31_536_000;

function requireSupportedLocale(value: unknown): SupportedLocale {
  const parsed = supportedLocaleSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Expected a canonical supported locale");
  }
  return parsed.data;
}

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

  const parsed = supportedLocaleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TypeError("Expected a route with a canonical leading locale");
  }
  return parsed.data;
}

export function createPresentationLocaleUrl(
  currentUrl: URL,
  nextLocale: unknown,
): URL {
  const locale = requireSupportedLocale(nextLocale);
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
  const value = requireSupportedLocale(locale);
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
