import type { ReactNode } from "react";
import type {
  StorefrontHomepageResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import { PublishedHeroImage, PublishedImage } from "./published-image";
import { storefrontHref } from "./navigation";
import { giftDetailHref } from "./gift-query";
import type { StorefrontCopy } from "./copy";
import { HowItWorks, PageState, StudioPromise } from "./page-parts";

export function HomeContent({
  data,
  locale,
  copy,
  contextQuery,
  directory,
}: Readonly<{
  data: StorefrontHomepageResponse;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  directory?: ReactNode;
}>) {
  if (data.outcome === "FAILURE")
    return (
      <PageState
        locale={locale}
        copy={copy}
        title={
          data.code === "NOT_FOUND" ? copy.artistEmptyTitle : copy.contentError
        }
        body={
          data.code === "NOT_FOUND"
            ? copy.artistEmptyDescription
            : copy.contentErrorBody
        }
        contextQuery={contextQuery}
      />
    );
  const view = data.homepage.content.view;
  const hero = data.slots.find(
    (slot) => slot.kind === "HERO_IDOL" && slot.status === "AVAILABLE",
  );
  const artists = data.slots.filter((slot) => slot.kind === "FEATURED_IDOL");
  const gifts = data.slots.filter((slot) => slot.kind === "FEATURED_GIFT");
  const heroArtist =
    hero?.status === "AVAILABLE" && hero.content.content.kind === "IDOL"
      ? hero.content.content.view
      : undefined;
  return (
    <>
      {view.announcement && (
        <p
          className="storefront-announcement"
          lang={view.localeContext.resolvedLocale}
        >
          {view.announcement}
        </p>
      )}
      {view.localeContext.schemaVersion === 1 &&
        view.localeContext.fallbackUsed && (
          <p className="storefront-announcement">{copy.fallbackNotice}</p>
        )}
      <section className="storefront-hero" aria-labelledby="hero-title">
        <div className="storefront-hero-copy">
          <p className="storefront-eyebrow">{copy.artistEyebrow}</p>
          <h1 id="hero-title" lang={view.localeContext.resolvedLocale}>
            {view.heroTitle}
          </h1>
          <p
            className="storefront-hero-body"
            lang={view.localeContext.resolvedLocale}
          >
            {view.heroSubtitle}
          </p>
          <a
            className="storefront-primary"
            href={storefrontHref(
              locale,
              heroArtist ? `/idols/${heroArtist.handle}` : "/idols",
              contextQuery,
            )}
            lang={view.localeContext.resolvedLocale}
          >
            {view.ctaLabel}
            <Icon name="arrow-right" decorative />
          </a>
          {heroArtist && (
            <div className="storefront-hero-caption">
              <span>{copy.artistEyebrow}</span>
              <a
                lang={heroArtist.localeContext.resolvedLocale}
                href={storefrontHref(
                  locale,
                  `/idols/${heroArtist.handle}`,
                  contextQuery,
                )}
              >
                {heroArtist.displayName}
              </a>
              <Icon name="arrow-right" decorative />
            </div>
          )}
        </div>
        <PublishedHeroImage
          desktop={view.heroDesktop}
          mobile={view.heroMobile}
          fallbackLabel={copy.mediaFallback}
        />
      </section>
      <section
        className="storefront-section"
        id="artists"
        aria-labelledby="featured-artists-title"
      >
        <div className="storefront-section-heading">
          <div>
            <p className="storefront-eyebrow">{copy.artistEyebrow}</p>
            <h2 id="featured-artists-title">{copy.artistTitle}</h2>
          </div>
          <a
            className="storefront-text-link"
            href={storefrontHref(locale, "/idols", contextQuery)}
          >
            {copy.backArtists}
            <Icon name="arrow-right" decorative />
          </a>
        </div>
        <div className="storefront-featured-shortcuts">
          {artists.map((slot) =>
            slot.status === "AVAILABLE" &&
            slot.content.content.kind === "IDOL" ? (
              <a
                key={slot.slotKey}
                href={storefrontHref(
                  locale,
                  `/idols/${slot.content.content.view.handle}`,
                  contextQuery,
                )}
                lang={slot.content.content.view.localeContext.resolvedLocale}
              >
                {slot.content.content.view.displayName}
                <Icon name="arrow-right" decorative />
              </a>
            ) : null,
          )}
        </div>
        {directory}
      </section>
      <section
        className="storefront-section storefront-gifts"
        id="gifts"
        aria-labelledby="featured-gifts-title"
      >
        <div className="storefront-section-heading">
          <div>
            <p className="storefront-eyebrow">{copy.giftEyebrow}</p>
            <h2 id="featured-gifts-title">{copy.giftTitle}</h2>
          </div>
          <p>{copy.giftBody}</p>
        </div>
        <div className="storefront-gift-grid">
          {gifts.map((slot) =>
            slot.status === "AVAILABLE" &&
            slot.content.content.kind === "GIFT" ? (
              <article
                key={slot.slotKey}
                lang={slot.content.content.view.localeContext.resolvedLocale}
              >
                <a
                  href={giftDetailHref(
                    locale,
                    slot.content.content.view.handle,
                    contextQuery,
                  )}
                >
                  <PublishedImage
                    media={slot.content.content.view.primaryMedia}
                    fallbackLabel={copy.mediaFallback}
                  />
                  <h3>{slot.content.content.view.title}</h3>
                </a>
                <p>{slot.content.content.view.shortDescription}</p>
              </article>
            ) : (
              <p key={slot.slotKey}>{copy.giftEmpty}</p>
            ),
          )}
        </div>
        {gifts.length === 0 && <p>{copy.giftEmpty}</p>}
        <a
          className="storefront-text-link"
          href={storefrontHref(locale, "/gifts", contextQuery)}
        >
          {copy.giftBrowse}
          <Icon name="arrow-right" decorative />
        </a>
      </section>
      <nav className="storefront-policy-links" aria-label={copy.trustTitle}>
        {view.slots
          .filter((slot) => slot.kind === "POLICY_LINK")
          .map((slot) => (
            <a
              key={slot.slotKey}
              lang={view.localeContext.resolvedLocale}
              href={storefrontHref(
                locale,
                `/policies/${slot.policyKey}`,
                contextQuery,
              )}
            >
              {slot.label}
            </a>
          ))}
      </nav>
      <HowItWorks copy={copy} />
      <StudioPromise copy={copy} />
      <section className="storefront-section storefront-final">
        <h2>{copy.finalTitle}</h2>
        <a
          className="storefront-primary"
          href={storefrontHref(locale, "/idols", contextQuery)}
        >
          {copy.navArtists}
          <Icon name="arrow-right" decorative />
        </a>
      </section>
    </>
  );
}
