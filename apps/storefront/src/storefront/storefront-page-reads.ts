import "server-only";
import { cache } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { readPublicCatalog } from "../server/public-catalog";

export { readCommerceContext } from "./gift-page-reads";

export const readStorefrontHomepage = cache((locale: SupportedLocale) =>
  readPublicCatalog(
    "/api/v1/storefront-homepage",
    new URLSearchParams({ locale }),
    "homepage",
  ),
);
export const readStorefrontIdol = cache(
  (locale: SupportedLocale, handle: string) =>
    readPublicCatalog(
      `/api/v1/idols/${encodeURIComponent(handle)}`,
      new URLSearchParams({ locale }),
      "content",
    ),
);
export const readStorefrontDirectory = cache(
  (query: string, valid: boolean) => {
    if (valid)
      return readPublicCatalog(
        "/api/v1/idols",
        new URLSearchParams(query),
        "directory",
      );
    return Promise.resolve({
      schemaVersion: 1 as const,
      outcome: "FAILURE" as const,
      code: "INVALID_QUERY" as const,
    });
  },
);
