import "server-only";
import { cache } from "react";
import type { StorefrontGiftReadCommand } from "@fan-support/contracts";
import { commerceRead, giftRead } from "./gift-page-reads";
import type { parseGiftSelection } from "./gift-selection";

type Command = StorefrontGiftReadCommand;

/** Request-local proof shared by the page, metadata and structured data. */
const read = cache(
  async (
    locale: Command["locale"],
    handle: Command["handle"],
    market: Command["market"] | undefined,
    currency: Command["currency"] | undefined,
    idolId: Command["idolId"],
  ) => {
    if (market === undefined || currency === undefined)
      return { result: await giftRead(locale, handle), scoped: undefined };

    const scoped = await commerceRead(locale, handle, market, currency, idolId);
    // A complete scoped response already proves its content publication. Only
    // an unavailable market needs a separate, introduction-only content read.
    const result =
      scoped.outcome === "FAILURE" && scoped.code === "MARKET_UNAVAILABLE"
        ? await giftRead(locale, handle)
        : scoped;
    return { result, scoped };
  },
);

export function readSelectedGiftContent(
  locale: Command["locale"],
  handle: Command["handle"],
  selection: ReturnType<typeof parseGiftSelection>,
) {
  // Primitive arguments let separately parsed page/metadata inputs share the
  // same React request cache; variant selection does not change the API read.
  return read(
    locale,
    handle,
    selection.kind === "VALID" ? selection.market : undefined,
    selection.kind === "VALID" ? selection.currency : undefined,
    selection.kind === "VALID" ? selection.idolId : undefined,
  );
}
