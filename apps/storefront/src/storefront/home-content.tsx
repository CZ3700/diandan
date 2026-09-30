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
import { HomeArtistSearch } from "./home-artist-search";
import { HeroMotion } from "./hero-motion";

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
  const artists = data.slots.filter((slot) => slot.kind === "FEATURED_IDOL");
  const sections: Record<HomeLayout["sections"][number]["id"], ReactNode> = {
    HERO: (
      <section
        className="storefront-hero"
        data-home-hero="true"
        aria-labelledby="hero-title"
      >
        <div className="storefront-hero-copy">
          <h1
            id="hero-title"
            className="storefront-eyebrow storefront-home-hero-heading"
            lang={locale}
          >
            {copy.artistEyebrow}
          </h1>
          <p
            className="storefront-hero-body"
            lang={view.localeContext.resolvedLocale}
          >
            {view.heroSubtitle}
          </p>
          {/* User request 2026-09-29 (L2-13): one gold button to all the artists. */}
          <a
            className="storefront-primary"
            data-home-hero-link="artists"
            href={storefrontHref(locale, "/idols", contextQuery)}
          >
            {copy.heroAllArtists}
            <Icon name="arrow-right" decorative />
          </a>
        </div>
        <PublishedHeroImage
          desktop={view.heroDesktop}
          mobile={view.heroMobile}
          fallbackLabel={copy.mediaFallback}
        >
          <HeroMotion copy={copy} />
        </PublishedHeroImage>
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
          <h2 id="featured-artists-title">{copy.artistTitle}</h2>
        </div>
        <HomeArtistSearch
          locale={locale}
          copy={copy}
          contextQuery={contextQuery}
        />
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
