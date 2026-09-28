import "server-only";
import {
  SUPPORTED_LOCALES,
  publicInformationPageIndexResponseSchema,
  type PublicInformationPageIndexResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { readPublicInformationPageIndex } from "./public-information-pages";
import {
  escapeSitemapXml as escape,
  sitemapFailure,
  sitemapXmlResponse,
} from "./sitemap";
import { informationPagePath } from "../storefront/information-page-path";
import { seoAlternateUrls } from "../storefront/seo-identity";

type Read = (
  locale: SupportedLocale,
) => Promise<PublicInformationPageIndexResponse>;
export async function informationSitemapLocales(
  read: Read = readPublicInformationPageIndex,
): Promise<SupportedLocale[]> {
  const result = publicInformationPageIndexResponseSchema.parse(
    await read("en"),
  );
  if (result.outcome !== "SUCCESS" || result.locale !== "en")
    throw new Error("Information index unavailable");
  return SUPPORTED_LOCALES.filter((locale) =>
    result.entries.some((entry) => entry.availableLocales.includes(locale)),
  );
}
export async function informationSitemapResponse(
  request: Request,
  origin: string,
  locale: SupportedLocale,
  read: Read = readPublicInformationPageIndex,
): Promise<Response> {
  if (new URL(request.url).search) return sitemapFailure(400);
  try {
    const result = publicInformationPageIndexResponseSchema.parse(
      await read(locale),
    );
    if (result.outcome !== "SUCCESS" || result.locale !== locale)
      return sitemapFailure(503);
    const entries = result.entries
      .filter((entry) => entry.availableLocales.includes(locale))
      .map((entry) => {
        const identity = {
          canonicalPath: informationPagePath(locale, entry.pageKey),
          noindex: false,
        };
        const alternates = seoAlternateUrls(
          origin,
          identity,
          entry.availableLocales,
        );
        return `<url><loc>${escape(new URL(identity.canonicalPath, origin).href)}</loc><lastmod>${escape(entry.publishedAt)}</lastmod>${Object.entries(
          alternates,
        )
          .map(
            ([language, href]) =>
              `<xhtml:link rel="alternate" hreflang="${language}" href="${escape(href)}"/>`,
          )
          .join("")}</url>`;
      });
    return sitemapXmlResponse(
      request,
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>`,
      locale,
    );
  } catch {
    return sitemapFailure(503);
  }
}
