import "server-only";
import { cache } from "react";
import type {
  StorefrontGiftReadCommand,
  SupportedLocale,
} from "@fan-support/contracts";
import { readPublicCatalog } from "../server/public-catalog";
import {
  readStorefrontContext,
  readPublishedGiftCommerce,
  readStorefrontGift,
  readStorefrontGiftDirectory,
} from "../server/public-commerce";

export const readCommerceContext = cache(readStorefrontContext);
export const giftRead = cache(readPublishedGiftCommerce);
export const policyRead = cache((locale: SupportedLocale, key: string) =>
  readPublicCatalog(
    `/api/v1/policies/${key}`,
    new URLSearchParams({ locale }),
    "content",
  ),
);
export const artistRead = cache((locale: SupportedLocale, id?: string) =>
  readPublicCatalog(
    "/api/v1/idols",
    new URLSearchParams({ locale, ...(id ? { anchorId: id } : {}) }),
    "directory",
  ),
);
export const giftDirectoryRead = cache((query: string) =>
  readStorefrontGiftDirectory(new URLSearchParams(query)),
);
type Command = StorefrontGiftReadCommand;
export const commerceRead = cache(
  (
    locale: Command["locale"],
    handle: Command["handle"],
    market: Command["market"],
    currency: Command["currency"],
    idolId?: Command["idolId"],
  ) =>
    readStorefrontGift({
      locale,
      handle,
      market,
      currency,
      ...(idolId ? { idolId } : {}),
    }),
);
