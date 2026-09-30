import { createDefaultStorefrontTheme } from "@fan-support/contracts";
import { expect, test } from "vitest";
import { themePresentation } from "./theme-presentation";

test("published appearance carries its actual version and visual presets without commerce data", () => {
  const theme = {
    ...createDefaultStorefrontTheme(),
    palette: "MIDNIGHT_BLUE" as const,
  };
  const attributes = themePresentation({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_THEME",
    source: "PUBLISHED",
    version: 8,
    publicationId: "57b6d87a-e095-413c-bde2-788ae3f4e114",
    theme,
  });
  expect(attributes).toEqual({
    "data-storefront-palette": "MIDNIGHT_BLUE",
    "data-storefront-scheme": "DARK",
    "data-storefront-typography": "STANDARD",
    "data-storefront-density": "STANDARD",
    "data-storefront-corners": "SOFT",
    "data-storefront-hero-layout": "IMMERSIVE",
    "data-storefront-gift-layout": "GRID",
    "data-storefront-motion": "STANDARD",
    "data-storefront-motion-speed": "STANDARD",
    "data-storefront-hero-effect": "STARLIGHT",
    "data-storefront-artist-template": "IMMERSIVE",
    "data-storefront-gift-template": "IMAGE_LEFT",
    "data-theme-source": "PUBLISHED",
    "data-theme-status": "AVAILABLE",
    "data-theme-version": 8,
  });
});
test("unconfigured default and unavailable theme are distinct presentation states", () => {
  expect(
    themePresentation({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_THEME",
      source: "DEFAULT",
      version: 0,
      publicationId: null,
      theme: createDefaultStorefrontTheme(),
    }),
  ).toMatchObject({
    "data-theme-source": "DEFAULT",
    "data-theme-status": "AVAILABLE",
    "data-theme-version": 0,
  });
  expect(
    themePresentation({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    }),
  ).toMatchObject({
    "data-theme-source": "FALLBACK",
    "data-theme-status": "UNAVAILABLE",
  });
});
