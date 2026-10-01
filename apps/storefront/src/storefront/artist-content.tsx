import type { ReactNode } from "react";
import type {
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import { PublishedHeroImage, PublishedImage } from "./published-image";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";
import { StudioPromise } from "./page-parts";
import { ArtistDescription } from "./artist-description";
export function ArtistContent({
  artist,
  locale,
  copy,
  contextQuery,
  gifts,
  wishes,
}: Readonly<{
  artist: PublishedIdolView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  gifts?: ReactNode;
  wishes?: ReactNode;
}>) {
  const query = new URLSearchParams(contextQuery);
  query.set("idol", artist.id);
  return (
    <article data-artist-detail={artist.id}>
      <section
        className="storefront-hero storefront-artist-hero"
        aria-labelledby="artist-title"
      >
        <div className="storefront-hero-copy">
          <a
            className="storefront-text-link"
            href={storefrontHref(locale, "/idols", contextQuery)}
          >
            <Icon name="arrow-left" decorative />
            {copy.backArtists}
          </a>
          <p className="storefront-eyebrow">
            {artist.acceptingGifts ? copy.artistAccepting : copy.artistPaused}
          </p>
          <h1 id="artist-title" lang={artist.localeContext.resolvedLocale}>
            {artist.displayName}
          </h1>
          <ArtistDescription
            text={
              artist.localeContext.schemaVersion === 2
                ? artist.fullBio
                : artist.shortBio
            }
            lang={artist.localeContext.resolvedLocale}
            expandLabel={copy.artistDescriptionExpand}
            collapseLabel={copy.artistDescriptionCollapse}
          />
          {artist.acceptingGifts && (
            <a
              className="storefront-primary"
              href={storefrontHref(locale, "/gifts", query.toString())}
            >
              {copy.giftChoose}
              <Icon name="arrow-right" decorative />
            </a>
          )}
        </div>
        <PublishedHeroImage
          desktop={artist.heroDesktop}
          mobile={artist.heroMobile}
          fallbackLabel={copy.mediaFallback}
        />
      </section>
      {artist.localeContext.schemaVersion === 1 &&
        artist.localeContext.fallbackUsed && (
          <p className="storefront-announcement">{copy.fallbackNotice}</p>
        )}
      {wishes}
      {artist.gallery.length > 0 && (
        <section className="storefront-section" aria-labelledby="gallery-title">
          <div className="storefront-section-heading">
            <h2 id="gallery-title">{copy.artistGallery}</h2>
          </div>
          <div className="storefront-gallery">
            {artist.gallery.map((media, index) => (
              <figure key={`${media.url}:${index}`}>
                <PublishedImage
                  media={media}
                  fallbackLabel={copy.mediaFallback}
                />
              </figure>
            ))}
          </div>
        </section>
      )}
      {gifts}
      <StudioPromise copy={copy} />
      <section className="storefront-section storefront-final">
        {/* 2026-10-01 user: the gift slogan left the gift lists (L2-17) and leaves here too. */}
        {artist.acceptingGifts ? null : <h2>{copy.artistPaused}</h2>}
        <p>{copy.giftHandover}</p>
        <a
          className="storefront-primary"
          href={storefrontHref(
            locale,
            artist.acceptingGifts ? "/gifts" : "/idols",
            artist.acceptingGifts ? query.toString() : contextQuery,
          )}
        >
          {artist.acceptingGifts ? copy.giftChoose : copy.backArtists}
          <Icon name="arrow-right" decorative />
        </a>
      </section>
    </article>
  );
}
