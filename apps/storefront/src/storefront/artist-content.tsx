import { ControlledBiography } from "./content-safety";
import type {
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import { PublishedHeroImage, PublishedImage } from "./published-image";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";
import { StudioPromise } from "./page-parts";
export function ArtistContent({
  artist,
  locale,
  copy,
  contextQuery,
}: Readonly<{
  artist: PublishedIdolView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
}>) {
  const query = new URLSearchParams(contextQuery);
  query.set("idol", artist.id);
  return (
    <>
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
          <p
            className="storefront-hero-body"
            lang={artist.localeContext.resolvedLocale}
          >
            {artist.shortBio}
          </p>
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
      {artist.localeContext.fallbackUsed && (
        <p className="storefront-announcement">{copy.fallbackNotice}</p>
      )}
      <section className="storefront-section storefront-story">
        <h2>{copy.aboutArtist}</h2>
        <div lang={artist.localeContext.resolvedLocale}>
          <ControlledBiography text={artist.fullBio} />
        </div>
      </section>
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
      <StudioPromise copy={copy} />
      <section className="storefront-section storefront-final">
        <h2>{artist.acceptingGifts ? copy.giftTitle : copy.artistPaused}</h2>
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
    </>
  );
}
