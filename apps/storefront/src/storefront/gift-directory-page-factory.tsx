import "server-only";
import type { SupportedLocale } from "@fan-support/contracts";
import { GiftDirectorySection } from "./gift-directory-section";
import { createGiftStorefrontPage } from "./gift-page-factory";

/** Keep the directory's client dependencies out of other gift-family routes. */
export function createGiftDirectoryPage(locale: SupportedLocale) {
  return createGiftStorefrontPage(locale, "gifts", GiftDirectorySection);
}
