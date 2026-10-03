"use client";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { navigationTargetHref } from "./navigation-target";
import { useStorefrontNavigation } from "./navigation-provider";

export function SiteNavigation({
  locale,
  copy,
  contextQuery,
  active,
  includeOrders = false,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  active: "home" | "artists" | "gifts" | "other";
  includeOrders?: boolean;
}>) {
  const { navigation } = useStorefrontNavigation();
  const labels = {
    HOME: copy.navHome,
    ARTISTS: copy.navArtists,
    GIFTS: copy.navGifts,
  };
  return (
    <nav aria-label={copy.navLabel}>
      {navigation.header.map((id) => (
        <a
          key={id}
          data-navigation-target={id}
          href={navigationTargetHref(locale, id, contextQuery)}
          aria-current={active === id.toLowerCase() ? "page" : undefined}
        >
          {labels[id]}
        </a>
      ))}
      {includeOrders && (
        <a
          data-navigation-target="ORDER_LOOKUP"
          href={navigationTargetHref(locale, "ORDER_LOOKUP")}
        >
          {copy.navOrders}
        </a>
      )}
    </nav>
  );
}
