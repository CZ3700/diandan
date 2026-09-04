import { expect, test } from "vitest";

async function loadInternalLocale() {
  const loaded = await import("./internal-presentation-locale.js");
  expect(
    loaded,
    "the internal preview locale adapter must exist",
  ).toBeDefined();
  return loaded;
}

test("changes only the locale segment of the gated interaction fixture", async () => {
  const { createInternalPresentationLocaleUrl } = await loadInternalLocale();
  const current = new URL(
    "https://storefront.example.invalid/_internal/design-foundations/en/interactions?cart=cart_fixture&market=US&currency=USD#menu",
  );

  const destination = createInternalPresentationLocaleUrl(current, "pt");

  expect(destination.href).toBe(
    "https://storefront.example.invalid/_internal/design-foundations/pt/interactions?cart=cart_fixture&market=US&currency=USD#menu",
  );
});

test("preserves a trailing slash and opaque query or fragment serialization", async () => {
  const { createInternalPresentationLocaleUrl } = await loadInternalLocale();
  const current = new URL(
    "https://storefront.example.invalid/_internal/design-foundations/en/interactions/?dup=first&dup=second&return=%2fen%20gift#state=%2Fen",
  );

  const destination = createInternalPresentationLocaleUrl(current, "vi");

  expect(destination.pathname).toBe(
    "/_internal/design-foundations/vi/interactions/",
  );
  expect(destination.search).toBe(current.search);
  expect(destination.hash).toBe(current.hash);
});

test.each(["en-XA", "fr", "EN", "", undefined])(
  "rejects internal-only or invalid destination locale %j",
  async (locale) => {
    const { createInternalPresentationLocaleUrl } = await loadInternalLocale();
    const current = new URL(
      "https://storefront.example.invalid/_internal/design-foundations/en/interactions",
    );

    expect(() => createInternalPresentationLocaleUrl(current, locale)).toThrow(
      /supported locale/u,
    );
  },
);

test.each([
  "https://storefront.example.invalid/_internal/design-foundations/en/primitives",
  "https://storefront.example.invalid/_internal/design-foundations/fr/interactions",
  "https://storefront.example.invalid/en/interactions",
])("rejects an unrelated source route: %s", async (href) => {
  const { createInternalPresentationLocaleUrl } = await loadInternalLocale();

  expect(() =>
    createInternalPresentationLocaleUrl(new URL(href), "ja"),
  ).toThrow(/interaction preview route/u);
});
