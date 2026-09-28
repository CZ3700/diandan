"use client";
import type { SupportedLocale } from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
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
    DESCRIPTION: <p data-footer-section="DESCRIPTION">{copy.giftHandover}</p>,
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
        <Icon name="arrow-right" decorative />
      </a>
    ),
    GIFTS: (
      <a
        data-footer-section="GIFTS"
        href={navigationTargetHref(locale, "GIFTS", contextQuery)}
      >
        {copy.navGifts}
        <Icon name="arrow-right" decorative />
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
      {navigation.footer
        .filter((item) => item.visible)
        .map(({ id }) => (
          <Fragment key={id}>{sections[id]}</Fragment>
        ))}
      {informationLinks}
    </footer>
  );
}
