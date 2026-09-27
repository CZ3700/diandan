import { Fragment, type ReactNode } from "react";
import {
  createDefaultHomeLayout,
  type HomeLayout,
  type StorefrontHomepageResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import { PublishedHeroImage } from "./published-image";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";
import { HomeKinds } from "./home-kinds";
import { HowItWorks, PageState, StudioPromise } from "./page-parts";

export function HomeContent({
  data,
  locale,
  copy,
  contextQuery,
  directory,
  giftDirectory,
  layout = createDefaultHomeLayout(),
}: Readonly<{
  data: StorefrontHomepageResponse;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  directory?: ReactNode;
  giftDirectory?: ReactNode;
  layout?: HomeLayout;
}>) {
  if (data.outcome === "FAILURE")
    return (
      <>
        <PageState
          locale={locale}
          copy={copy}
          title={
            data.code === "NOT_FOUND"
              ? copy.artistEmptyTitle
              : copy.contentError
          }
          body={
            data.code === "NOT_FOUND"
              ? copy.artistEmptyDescription
              : copy.contentErrorBody
          }
          contextQuery={contextQuery}
        />
        {layout.sections.find((section) => section.id === "KINDS")?.visible && (
          <HomeKinds locale={locale} copy={copy} contextQuery={contextQuery} />
        )}
        {giftDirectory}
      </>
    );
  const view = data.homepage.content.view;
  const hero = data.slots.find(
    (slot) => slot.kind === "HERO_IDOL" && slot.status === "AVAILABLE",
  );
  const artists = data.slots.filter((slot) => slot.kind === "FEATURED_IDOL");
  const heroArtist =
    hero?.status === "AVAILABLE" && hero.content.content.kind === "IDOL"
      ? hero.content.content.view
      : undefined;
  const sections: Record<HomeLayout["sections"][number]["id"], ReactNode> = {
    HERO: (
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
    ),
    KINDS: (
      <HomeKinds locale={locale} copy={copy} contextQuery={contextQuery} />
    ),
    ARTISTS: (
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
        {!directory && (
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
        )}
        {directory}
      </section>
    ),
    GIFTS: giftDirectory,
    POLICIES: (
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
    ),
    HOW_IT_WORKS: <HowItWorks copy={copy} />,
    STUDIO_PROMISE: <StudioPromise copy={copy} />,
    FINAL_CTA: (
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
    ),
  };
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
      {layout.sections.map((section) =>
        section.visible ? (
          <Fragment key={section.id}>{sections[section.id]}</Fragment>
        ) : null,
      )}
    </>
  );
}
