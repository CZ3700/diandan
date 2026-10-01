import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { expect, test, vi } from "vitest";

const request = vi.hoisted(() => ({ locale: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      request.locale ? { "x-storefront-locale": request.locale } : {},
    ),
}));
vi.mock(
  "../server/storefront-copy",
  async () => import("@fan-support/i18n/storefront"),
);

test.each(SUPPORTED_LOCALES)(
  "unmatched %s pages show a localized recovery link",
  async (locale) => {
    request.locale = locale;
    const { default: NotFound } = await import("./not-found");
    const copy = await loadStorefrontCopy(locale);
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(`<h1>${copy.notFound}</h1>`);
    expect(html).toContain(`href="/${locale}"`);
    expect(html).toContain(copy.navHome);
    expect(html).not.toContain(copy.artistEmptyDescription);
    expect(html.match(/<a /gu)).toHaveLength(1);
  },
);

test.each([null, "xx", "<script>PRIVATE_PATH</script>"])(
  "unknown locale %s uses the source language without reflecting input",
  async (locale) => {
    request.locale = locale;
    const { default: NotFound } = await import("./not-found");
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain(`lang="${DEFAULT_LOCALE}"`);
    expect(html).toContain(`href="/${DEFAULT_LOCALE}"`);
    expect(html).not.toContain("PRIVATE_PATH");
  },
);
