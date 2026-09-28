import "server-only";
import type {
  StorefrontContextResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { readGiftBrowse } from "../server/public-gift-browse";
import { artistRead, readCommerceContext } from "./gift-page-reads";
import { readGiftDetailPage } from "./gift-detail-page-reads";
import { ArtistDetailBody } from "./artist-detail-body";
import { giftDetailBody } from "./gift-detail-body";
import { PageState } from "./page-parts";
import type { StorefrontCopy } from "./copy";

/** Automatic published samples only. No private session or caller-controlled content URL. */
export async function DetailPreviewContent({
  page,
  locale,
  copy,
}: Readonly<{
  page: "artist" | "gift";
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const error = (
    <PageState
      locale={locale}
      copy={copy}
      title={copy.contentError}
      body={copy.contentErrorBody}
    />
  );
  const artists = artistRead(locale).catch(() => undefined);
  if (page === "artist") {
    const result = await artists;
    if (result?.outcome !== "SUCCESS") return error;
    const artist = result.items[0];
    return artist ? (
      <ArtistDetailBody
        locale={locale}
        copy={copy}
        artist={artist}
        values={{}}
      />
    ) : (
      <PageState
        locale={locale}
        copy={copy}
        title={copy.artistEmptyTitle}
        body={copy.artistEmptyDescription}
      />
    );
  }
  const [gifts, directory] = await Promise.all([
    readGiftBrowse({ schemaVersion: 1, locale, page: 1, pageSize: 1 }),
    artists,
  ]);
  if (gifts.outcome !== "SUCCESS") return error;
  const gift = gifts.items[0];
  if (!gift)
    return (
      <PageState
        locale={locale}
        copy={copy}
        title={copy.giftEmpty}
        body={copy.giftEmpty}
      />
    );
  const artist =
    directory?.outcome === "SUCCESS" ? directory.items[0] : undefined;
  const values = artist ? { idol: artist.id } : {};
  const context = readCommerceContext().catch(
    (): StorefrontContextResponse => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "COMMERCE_UNAVAILABLE",
    }),
  );
  const detail = await readGiftDetailPage(locale, gift.handle, values);
  return giftDetailBody({ locale, copy, detail, values, context });
}
