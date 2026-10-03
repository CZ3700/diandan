import { NextResponse } from "next/server";
import type {
  InformationPageKey,
  SupportedLocale,
} from "@fan-support/contracts";
import { REQUEST_ID_HEADER } from "@fan-support/observability";
import { readPublicInformationPage } from "./public-information-pages";
import { readPublicStorefrontTheme } from "./public-storefront-theme";
import { loadStorefrontCopy } from "./storefront-copy";
import {
  DESIGN_TOKEN_CONTRACT,
  FONT_PROFILE_BY_LOCALE,
  STOREFRONT_THEME_PALETTES,
} from "@fan-support/design-tokens";
import { informationPagePath } from "../storefront/information-page-path";
import { themePresentation } from "../storefront/theme-presentation";

// This independent error document needs no application JS, CSS chunks or webfont request.
function errorStyle(
  presentation: ReturnType<typeof themePresentation>,
  locale: SupportedLocale,
) {
  const tokens = {
    ...DESIGN_TOKEN_CONTRACT.values,
    ...DESIGN_TOKEN_CONTRACT.runtimeDefaults,
    ...STOREFRONT_THEME_PALETTES[presentation["data-storefront-palette"]],
    "--font-ui": `"${FONT_PROFILE_BY_LOCALE[locale].family}",${DESIGN_TOKEN_CONTRACT.runtimeDefaults["--font-ui"]}`,
  };
  return `:root{color-scheme:${presentation["data-storefront-scheme"].toLowerCase()};${Object.entries(
    tokens,
  )
    .map(([key, value]) => `${key}:${value}`)
    .join(
      ";",
    )}}body{margin:0;background:var(--color-bg);color:var(--color-text);font-family:var(--font-ui);font-size:var(--type-body-size);line-height:var(--type-body-leading)}main{max-width:var(--layout-reading-max);margin:var(--space-32) auto;padding:var(--space-8);overflow-wrap:anywhere}h1{font-size:var(--type-heading-size);line-height:var(--type-heading-script-leading)}p{color:var(--color-text-muted)}nav{display:flex;flex-wrap:wrap;gap:var(--space-6)}a{color:var(--color-accent);display:inline-flex;align-items:center;min-height:var(--space-12)}a:focus-visible{outline:var(--focus-ring-width) solid var(--color-accent);outline-offset:var(--space-1)}`;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Terminate known failures before Next starts streaming. The page still verifies its own publication snapshot. */
export async function informationPagePreflight(
  response: NextResponse,
  pageKey: InformationPageKey,
  locale: SupportedLocale,
  requestId: string,
): Promise<NextResponse> {
  const result = await readPublicInformationPage(pageKey, locale);
  response.headers.set("cache-control", "no-store");
  if (result.outcome === "SUCCESS") {
    if (result.fallbackUsed)
      response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }
  const status = result.code === "NOT_FOUND" ? 404 : 503;
  const [copy, theme] = await Promise.all([
    loadStorefrontCopy(locale),
    readPublicStorefrontTheme(),
  ]);
  const presentation = themePresentation(theme);
  const attributes = Object.entries({
    "data-font-profile": FONT_PROFILE_BY_LOCALE[locale].id,
    ...presentation,
  })
    .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`)
    .join(" ");
  const title = escapeHtml(status === 404 ? copy.notFound : copy.contentError);
  const body =
    status === 503 ? `<p>${escapeHtml(copy.contentErrorBody)}</p>` : "";
  const retry =
    status === 503
      ? `<a href="${informationPagePath(locale, pageKey)}">${escapeHtml(copy.artistRetry)}</a>`
      : "";
  return new NextResponse(
    `<!doctype html><html lang="${locale}" ${attributes}><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><style>${errorStyle(presentation, locale)}</style></head><body><main><h1>${title}</h1>${body}<nav>${retry}<a href="/${locale}">${escapeHtml(copy.navHome)}</a></nav></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-language": locale,
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
        [REQUEST_ID_HEADER]: requestId,
        ...(status === 503 ? { "retry-after": "30" } : {}),
      },
    },
  );
}
