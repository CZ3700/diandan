import type { Metadata } from "next";
import type {
  ContentLocaleContext,
  PublishedMediaView,
  StorefrontSeoEntity,
  SupportedLocale,
} from "@fan-support/contracts";
import { seoAlternateUrls, type SeoIdentity } from "./seo-identity";

/** Separate HTTP snapshots may race a publication; never combine metadata from different revisions. */
export function provenSeoLocales(
  entity: StorefrontSeoEntity | undefined,
  publication: StorefrontSeoEntity["publication"],
  context: ContentLocaleContext,
): SupportedLocale[] {
  if (
    !entity ||
    context.fallbackUsed ||
    context.requestedLocale !== context.resolvedLocale ||
    entity.publication.id !== publication.id ||
    entity.publication.revisionId !== publication.revisionId ||
    entity.publication.manifestHash !== publication.manifestHash ||
    entity.publication.publishedAt !== publication.publishedAt ||
    !entity.locales.some(
      (row) =>
        row.locale === context.resolvedLocale &&
        row.translationRevision === context.translationRevision,
    )
  )
    return [];
  return entity.locales.map((row) => row.locale);
}

export function buildSeoMetadata(
  input: Readonly<{
    origin: string;
    siteName: string;
    locale: SupportedLocale;
    identity: SeoIdentity;
    title: string;
    description: string;
    availableLocales: readonly SupportedLocale[];
    indexable: boolean;
    production: boolean;
    image?: Pick<PublishedMediaView, "url" | "width" | "height" | "alt">;
  }>,
): Metadata {
  const eligible =
    input.indexable &&
    !input.identity.noindex &&
    input.availableLocales.includes(input.locale);
  const url = new URL(input.identity.canonicalPath, input.origin).href;
  const images = input.image
    ? [
        {
          url: input.image.url,
          width: input.image.width,
          height: input.image.height,
          alt: input.image.alt,
        },
      ]
    : [];
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: url,
      languages: seoAlternateUrls(
        input.origin,
        { ...input.identity, noindex: !eligible },
        input.availableLocales,
      ),
    },
    robots: { index: eligible && input.production, follow: true },
    openGraph: {
      type: "website",
      url,
      siteName: input.siteName,
      title: input.title,
      description: input.description,
      locale: input.locale.replaceAll("-", "_"),
      alternateLocale: eligible
        ? input.availableLocales
            .filter((locale) => locale !== input.locale)
            .map((locale) => locale.replaceAll("-", "_"))
        : [],
      images,
    },
    twitter: {
      card: input.image ? "summary_large_image" : "summary",
      title: input.title,
      description: input.description,
      images: input.image
        ? [{ url: input.image.url, alt: input.image.alt }]
        : [],
    },
  };
}
