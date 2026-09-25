import { expect, test, vi } from "vitest";
import type { SupportedLocale } from "@fan-support/contracts";
import type * as Contracts from "@fan-support/contracts";

// Header navigation must work with the canonical value leaf alone. Runtime
// schemas remain available at HTTP boundaries, but are not a header dependency.
vi.mock("@fan-support/contracts", async (load) => {
  const actual = await load<typeof Contracts>();
  return {
    SUPPORTED_LOCALES: actual.SUPPORTED_LOCALES,
    parseSupportedLocale: actual.parseSupportedLocale,
  };
});

import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  createPresentationLocaleUrl,
  serializePresentationLocaleCookie,
} from "./presentation-locale";
import { storefrontHref } from "./storefront/navigation";

test.each(SUPPORTED_LOCALES)(
  "%s navigation uses canonical values without schemas",
  (locale) => {
    expect(
      storefrontHref(locale, "/gifts", "cart=first&cart=second&currency=USD"),
    ).toBe(`/${locale}/gifts?cart=first&cart=second&currency=USD`);
    const current = new URL(
      "https://example.invalid/en/gifts?cart=one&cart=two#item",
    );
    expect(createPresentationLocaleUrl(current, locale).href).toBe(
      `https://example.invalid/${locale}/gifts?cart=one&cart=two#item`,
    );
    expect(serializePresentationLocaleCookie(locale, { secure: true })).toBe(
      `site_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  },
);

test.each(["EN", "zh-cn", " en ", "en-XA", "fr", "", undefined])(
  "canonical-only navigation rejects %j with a useful type error",
  (locale) => {
    expect(() => storefrontHref(locale as SupportedLocale, "/gifts")).toThrow(
      new TypeError("Expected a canonical supported locale"),
    );
    expect(() =>
      createPresentationLocaleUrl(
        new URL("https://example.invalid/en"),
        locale,
      ),
    ).toThrow(new TypeError("Expected a canonical supported locale"));
  },
);

test.each([
  "//foreign.invalid",
  "/gifts?next=1",
  "/gifts#one",
  "/gifts\\other",
  "gifts",
])("navigation still rejects non-local paths: %s", (path) => {
  expect(() => storefrontHref("en", path)).toThrow(
    new TypeError("Expected a local storefront path"),
  );
});
