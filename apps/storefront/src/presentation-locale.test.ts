import { expect, test } from "vitest";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";

async function loadPresentationLocale() {
  const loaded = await import("./presentation-locale.js");

  expect(
    loaded,
    "the storefront presentation-locale adapter must exist",
  ).toBeDefined();
  return loaded;
}

test("changes only the leading public locale while preserving transaction context", async () => {
  const { createPresentationLocaleUrl } = await loadPresentationLocale();
  const current = new URL(
    "https://storefront.example.invalid/en/idols/aurora?cart=cart_fixture&market=US&currency=USD&amount=2599&paymentAttempt=attempt_fixture#gift-rose",
  );

  const destination = createPresentationLocaleUrl(current, "ja");

  expect(destination.href).toBe(
    "https://storefront.example.invalid/ja/idols/aurora?cart=cart_fixture&market=US&currency=USD&amount=2599&paymentAttempt=attempt_fixture#gift-rose",
  );
  expect(Object.fromEntries(destination.searchParams)).toEqual(
    Object.fromEntries(current.searchParams),
  );
  expect(destination.hash).toBe(current.hash);
});

test("preserves an optional trailing slash", async () => {
  const { createPresentationLocaleUrl } = await loadPresentationLocale();

  expect(
    createPresentationLocaleUrl(
      new URL("https://storefront.example.invalid/en/"),
      "es",
    ).href,
  ).toBe("https://storefront.example.invalid/es/");
});

test("preserves duplicate keys and encoded query or fragment text exactly", async () => {
  const { createPresentationLocaleUrl } = await loadPresentationLocale();
  const current = new URL(
    "https://storefront.example.invalid/en/gifts/en?return=%2fen%2Fgifts%2Fen&dup=first&dup=second&space=a%20b#return=%2Fen",
  );

  const destination = createPresentationLocaleUrl(current, "pt");

  expect(destination.pathname).toBe("/pt/gifts/en");
  expect(destination.search).toBe(current.search);
  expect(destination.hash).toBe(current.hash);
});

test.each(SUPPORTED_LOCALES)(
  "accepts canonical public locale %s",
  async (locale) => {
    const { createPresentationLocaleUrl } = await loadPresentationLocale();
    const destination = createPresentationLocaleUrl(
      new URL("https://storefront.example.invalid/en/gifts/light-stick"),
      locale,
    );

    expect(destination.pathname).toBe(`/${locale}/gifts/light-stick`);
  },
);

test.each(["en-XA", "EN", "zh-cn", " en ", "fr", "", undefined])(
  "rejects non-canonical destination locale %j",
  async (locale) => {
    const { createPresentationLocaleUrl } = await loadPresentationLocale();

    expect(() =>
      createPresentationLocaleUrl(
        new URL("https://storefront.example.invalid/en/cart"),
        locale,
      ),
    ).toThrow(/supported locale/u);
  },
);

test.each([
  "https://storefront.example.invalid/cart",
  "https://storefront.example.invalid/en-XA/cart",
  "https://storefront.example.invalid/EN/cart",
  "https://storefront.example.invalid/en//cart",
])(
  "rejects a source route without a canonical public locale: %s",
  async (href) => {
    const { createPresentationLocaleUrl } = await loadPresentationLocale();

    expect(() => createPresentationLocaleUrl(new URL(href), "es")).toThrow(
      /leading locale/u,
    );
  },
);

test("serializes a minimal first-party preference cookie without a domain", async () => {
  const { serializePresentationLocaleCookie } = await loadPresentationLocale();

  expect(serializePresentationLocaleCookie("zh-CN", { secure: false })).toBe(
    "site_locale=zh-CN; Path=/; Max-Age=31536000; SameSite=Lax",
  );
  expect(serializePresentationLocaleCookie("pt", { secure: true })).toBe(
    "site_locale=pt; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
  );
});

test.each(["en-XA", "EN", "fr", null])(
  "never serializes an invalid locale cookie value %j",
  async (locale) => {
    const { serializePresentationLocaleCookie } =
      await loadPresentationLocale();

    expect(() =>
      serializePresentationLocaleCookie(locale, { secure: true }),
    ).toThrow(/supported locale/u);
  },
);
