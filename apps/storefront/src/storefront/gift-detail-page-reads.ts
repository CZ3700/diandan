import "server-only";
import type {
  IdolDirectoryResponse,
  StorefrontGiftReadCommand,
  SupportedLocale,
} from "@fan-support/contracts";
import { artistRead, commerceRead, giftRead } from "./gift-page-reads";
import { parseGiftSelection } from "./gift-selection";

/** Only current gift and scoped offer proofs gate the page's first response. */
export async function readGiftDetailPage(
  locale: SupportedLocale,
  handle: StorefrontGiftReadCommand["handle"],
  values: Parameters<typeof parseGiftSelection>[0],
) {
  const selection = parseGiftSelection(values);
  const resultRead = giftRead(locale, handle);
  const scopedRead =
    selection.kind === "VALID"
      ? commerceRead(
          locale,
          handle,
          selection.market,
          selection.currency,
          selection.idolId,
        )
      : undefined;
  const artists = artistRead(
    locale,
    typeof values["idol"] === "string" ? values["idol"] : undefined,
  ).catch((): IdolDirectoryResponse => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  }));
  const [result, scoped] = await Promise.all([resultRead, scopedRead]);
  return { handle, selection, result, scoped, artists };
}
