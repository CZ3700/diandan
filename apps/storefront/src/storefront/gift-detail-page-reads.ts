import "server-only";
import type {
  IdolDirectoryResponse,
  StorefrontGiftReadCommand,
  SupportedLocale,
} from "@fan-support/contracts";
import { artistRead } from "./gift-page-reads";
import { readSelectedGiftContent } from "./gift-content-read";
import { parseGiftSelection } from "./gift-selection";

/** Only the selected gift's complete current proof gates the first response. */
export async function readGiftDetailPage(
  locale: SupportedLocale,
  handle: StorefrontGiftReadCommand["handle"],
  values: Parameters<typeof parseGiftSelection>[0],
) {
  const selection = parseGiftSelection(values);
  const content = readSelectedGiftContent(locale, handle, selection);
  const artists = artistRead(
    locale,
    typeof values["idol"] === "string" ? values["idol"] : undefined,
  ).catch((): IdolDirectoryResponse => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  }));
  const { result, scoped } = await content;
  return { handle, selection, result, scoped, artists };
}
