import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { loadStorefrontRuntimeConfig } from "../../server/runtime-config";
export const dynamic = "force-dynamic";
export async function GET() {
  const origin = loadStorefrontRuntimeConfig().siteOrigin;
  const production = process.env["FAN_SUPPORT_DEPLOYMENT_ENV"] === "production";
  const lines = production
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /_internal/",
        ...SUPPORTED_LOCALES.flatMap((locale) =>
          ["cart", "checkout", "orders", "payment"].map(
            (path) => `Disallow: /${locale}/${path}`,
          ),
        ),
        `Sitemap: ${new URL("/sitemap.xml", origin).href}`,
      ]
    : ["User-agent: *", "Disallow: /"];
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
