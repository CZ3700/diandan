import "server-only";
import { Suspense } from "react";
import type {
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { ArtistContent } from "./artist-content";
import { ArtistGiftDirectory } from "./artist-gift-directory";
import { queryString } from "./navigation";

export function ArtistDetailBody({
  artist,
  locale,
  copy,
  values,
}: Readonly<{
  artist: PublishedIdolView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  values: Readonly<Record<string, string | string[] | undefined>>;
}>) {
  return (
    <ArtistContent
      artist={artist}
      locale={locale}
      copy={copy}
      contextQuery={queryString(values)}
      gifts={
        <Suspense
          fallback={
            <section
              className="storefront-section storefront-directory storefront-gifts"
              id="artist-gifts"
              aria-busy="true"
            >
              <p role="status">{copy.loading}</p>
            </section>
          }
        >
          <ArtistGiftDirectory
            locale={locale}
            copy={copy}
            values={{ ...values, idol: artist.id }}
            basePath={`/idols/${artist.handle}`}
            headingLevel={2}
            artist={artist}
          />
        </Suspense>
      }
    />
  );
}
