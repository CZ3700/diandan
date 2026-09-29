"use client";

import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { ArtistSearch } from "./artist-search";
import { storefrontHref } from "./navigation";

/** The homepage hero's single artist guide: picking a result opens that artist. */
export function HeroArtistSearch({
  locale,
  copy,
  contextQuery,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
}>) {
  return (
    <ArtistSearch
      compact
      locale={locale}
      copy={copy}
      onSelect={(artist) => {
        window.location.assign(
          storefrontHref(locale, `/idols/${artist.handle}`, contextQuery),
        );
      }}
    />
  );
}
