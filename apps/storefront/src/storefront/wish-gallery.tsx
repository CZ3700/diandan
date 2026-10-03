import type {
  SupportedLocale,
  WishGalleryEntry,
  WishGalleryReadResponse,
} from "@fan-support/contracts";
import { Media } from "@fan-support/ui/client";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { storefrontHref } from "./navigation";

export function WishMedallion() {
  return (
    <svg
      className="wish-medallion"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="29" stroke="currentColor" />
      <circle
        cx="32"
        cy="32"
        r="23"
        stroke="currentColor"
        strokeDasharray="1 5"
      />
      <path
        d="m32 16 4.5 10 11 1.5-8 8 2 11-9.5-5-9.5 5 2-11-8-8 11-1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
function WishGalleryCard({
  entry,
  locale,
  copy,
}: Readonly<{
  entry: WishGalleryEntry;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(entry.supportedAt));
  const supporter =
    entry.supporter.kind === "NAMED"
      ? entry.supporter.alias
      : copy.wishDisplayAnonymous;
  return (
    <li className="wish-gallery-card" data-wish-entry={entry.entryId}>
      <div className="wish-gallery-art">
        <Media
          src={entry.gift.image.url}
          alt={entry.gift.image.alt}
          lang={entry.gift.image.locale}
          width={640}
          height={640}
          fit="contain"
          fallbackLabel={copy.mediaFallback}
        />
        <span className="wish-gallery-seal">
          <WishMedallion />
        </span>
      </div>
      <div className="wish-gallery-card-body">
        <p className="storefront-eyebrow">{copy.wishSupported}</p>
        <h2 lang={entry.gift.locale}>{entry.gift.title}</h2>
        <a
          className="wish-gallery-artist"
          href={storefrontHref(locale, `/idols/${entry.idol.handle}`)}
        >
          <Media
            src={entry.idol.portrait.url}
            alt={entry.idol.portrait.alt}
            lang={entry.idol.portrait.locale}
            width={40}
            height={40}
            fit="cover"
            fallbackLabel={copy.mediaFallback}
          />
          <span lang={entry.idol.locale}>{entry.idol.displayName}</span>
        </a>
        <p>
          <time dateTime={entry.supportedAt}>
            {formatStorefrontMessage(copy, "wishSupportedBy", locale, {
              supporter,
              artist: entry.idol.displayName,
              date,
            })}
          </time>
        </p>
      </div>
    </li>
  );
}
export function WishGallery({
  result,
  locale,
  copy,
  idolId,
}: Readonly<{
  result: WishGalleryReadResponse;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  idolId?: string;
}>) {
  if (result.outcome === "FAILURE")
    return (
      <div className="wish-gallery-empty">
        <p role="status">{copy.wishGalleryError}</p>
        <a
          className="storefront-text-link"
          href={storefrontHref(
            locale,
            "/wish-gallery",
            idolId ? new URLSearchParams({ idol: idolId }).toString() : "",
          )}
        >
          {copy.artistRetry}
        </a>
      </div>
    );
  return (
    <>
      {result.page.entries.length === 0 ? (
        <p className="wish-gallery-empty">{copy.wishShowcaseEmpty}</p>
      ) : (
        <ul className="wish-gallery-grid">
          {result.page.entries.map((entry) => (
            <WishGalleryCard
              key={entry.entryId}
              entry={entry}
              locale={locale}
              copy={copy}
            />
          ))}
        </ul>
      )}
      {result.page.nextCursor && (
        <a
          className="storefront-text-link wish-gallery-more"
          href={storefrontHref(
            locale,
            "/wish-gallery",
            new URLSearchParams({
              ...(idolId ? { idol: idolId } : {}),
              cursor: result.page.nextCursor,
            }).toString(),
          )}
        >
          {copy.wishShowcaseMore}
        </a>
      )}
    </>
  );
}
