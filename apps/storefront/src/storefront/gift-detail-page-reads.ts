import "server-only";
import type {
  StorefrontGiftReadCommand,
  SupportedLocale,
} from "@fan-support/contracts";
import { artistRead, commerceRead, giftRead } from "./gift-page-reads";
import { parseGiftSelection } from "./gift-selection";

/** Independent canonical reads share no mutable state; the page validates all results before rendering. */
export async function readGiftDetailPage(
  locale: SupportedLocale,
  handle: StorefrontGiftReadCommand["handle"],
  values: Parameters<typeof parseGiftSelection>[0],
) {
  const selection = parseGiftSelection(values);
  const [result, scoped, artists] = await Promise.all([
    giftRead(locale, handle),
    selection.kind === "VALID"
      ? commerceRead(
          locale,
          handle,
          selection.market,
          selection.currency,
          selection.idolId,
        )
      : undefined,
    artistRead(
      locale,
      typeof values["idol"] === "string" ? values["idol"] : undefined,
    ),
  ]);
  return { handle, selection, result, scoped, artists };
}
