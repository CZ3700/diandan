import "server-only";
import type {
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import { readGiftBrowse } from "../server/public-gift-browse";
import type { StorefrontCopy } from "./copy";
import { GiftCard } from "./gift-card";
import { storefrontHref } from "./navigation";

export async function ArtistWishes({
  artist,
  locale,
  copy,
}: Readonly<{
  artist: Pick<PublishedIdolView, "id">;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const result = await readGiftBrowse({
    schemaVersion: 1,
    locale,
    kind: "WISH",
    idolId: artist.id,
    page: 1,
    pageSize: 4,
  });
  const query = new URLSearchParams({
    kind: "WISH",
    idol: artist.id,
  }).toString();
  return (
    <section
      className="storefront-section gift-directory artist-wishes"
      aria-label={copy.wishTitle}
    >
      {result.outcome === "FAILURE" ? (
        <p role="status">{copy.contentErrorBody}</p>
      ) : result.items.length === 0 ? (
        <p>{copy.artistWishesEmpty}</p>
      ) : (
        <>
          <div className="wish-directory-intro">
            <a
              className="storefront-text-link wish-gallery-title"
              href={storefrontHref(
                locale,
                "/wish-gallery",
                new URLSearchParams({ idol: artist.id }).toString(),
              )}
            >
              {copy.wishShowcaseTitle}
            </a>
          </div>
          <ul className="gift-directory-grid">
            {result.items.map((gift) => (
              <GiftCard
                key={gift.id}
                gift={gift}
                locale={locale}
                copy={copy}
                contextQuery={query}
                headingLevel={2}
              />
            ))}
          </ul>
          {result.pageInfo.totalPages > 1 && (
            <a
              className="storefront-text-link"
              href={storefrontHref(locale, "/gifts", query)}
            >
              {copy.wishShowcaseMore}
            </a>
          )}
        </>
      )}
    </section>
  );
}
