"use client";
import type { SupportedLocale } from "@fan-support/contracts";
import { Fragment, type ReactNode } from "react";
import type { StorefrontCopy } from "./copy";
import { navigationTargetHref } from "./navigation-target";
import { useStorefrontNavigation } from "./navigation-provider";

export function SiteFooter({
  copy,
  locale,
  name,
  contextQuery,
  policyLinks,
  informationLinks,
  region,
}: Readonly<{
  copy: StorefrontCopy;
  locale: SupportedLocale;
  name: string;
  contextQuery: string;
  policyLinks?: ReactNode;
  informationLinks?: ReactNode;
  /** Server-decided region entry; a sole published market hides it. */
  region?: ReactNode;
}>) {
  const { navigation, source, version } = useStorefrontNavigation();
  const sections = {
    // Retained in saved navigation revisions for compatibility, no longer displayed.
    DESCRIPTION: null,
    REGION: region ?? (
      <a href={navigationTargetHref(locale, "REGION", contextQuery)}>
        {copy.region}
      </a>
    ),
    ARTISTS: (
      <a
        data-footer-section="ARTISTS"
        href={navigationTargetHref(locale, "ARTISTS", contextQuery)}
      >
        {copy.backArtists}
      </a>
    ),
    GIFTS: (
      <a
        data-footer-section="GIFTS"
        href={navigationTargetHref(locale, "GIFTS", contextQuery)}
      >
        {copy.navGifts}
      </a>
    ),
    POLICIES: policyLinks,
  };
  return (
    <footer
      className="storefront-footer"
      data-navigation-source={source}
      data-navigation-version={version}
    >
      <span className="storefront-wordmark">
        {name}
        <span aria-hidden="true">.</span>
      </span>
      <div className="storefront-footer-links">
        {navigation.footer
          .filter((item) => item.visible)
          .map(({ id }) => (
            <Fragment key={id}>{sections[id]}</Fragment>
          ))}
        {informationLinks}
      </div>
    </footer>
  );
}
