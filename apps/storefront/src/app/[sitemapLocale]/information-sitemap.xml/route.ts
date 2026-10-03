import { supportedLocaleSchema } from "@fan-support/contracts";
import { loadStorefrontRuntimeConfig } from "../../../server/runtime-config";
import { informationSitemapResponse } from "../../../server/information-sitemap";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ sitemapLocale: string }> },
) {
  const locale = supportedLocaleSchema.safeParse(
    (await context.params).sitemapLocale,
  );
  if (!locale.success)
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  return informationSitemapResponse(
    request,
    loadStorefrontRuntimeConfig().siteOrigin,
    locale.data,
  );
}
