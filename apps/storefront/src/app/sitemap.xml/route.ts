import { loadStorefrontRuntimeConfig } from "../../server/runtime-config";
import { readStorefrontSeo } from "../../server/storefront-seo";
import { sitemapResponse } from "../../server/sitemap";
import { informationSitemapLocales } from "../../server/information-sitemap";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return sitemapResponse(
    request,
    loadStorefrontRuntimeConfig().siteOrigin,
    readStorefrontSeo,
    undefined,
    informationSitemapLocales,
  );
}
