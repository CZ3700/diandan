import { expect, test } from "vitest";
import {
  createDefaultStorefrontTheme,
  storefrontThemeSchema,
  storefrontThemeCommandSchema,
  publicStorefrontThemeResponseSchema,
  storefrontThemePreviewMessageSchema,
} from "./index.js";

test("default preserves the accepted black gold presentation and returns independent values", () => {
  const theme = createDefaultStorefrontTheme();
  expect(theme).toEqual({
    schemaVersion: 1,
    palette: "BLACK_GOLD",
    typography: "STANDARD",
    density: "STANDARD",
    corners: "SOFT",
  });
  expect(storefrontThemeSchema.safeParse(theme).success).toBe(true);
  theme.palette = "GRAPHITE_PEARL";
  expect(createDefaultStorefrontTheme().palette).toBe("BLACK_GOLD");
});
test("all deployed presets are accepted and unknown executable or commerce settings are rejected", () => {
  const theme = createDefaultStorefrontTheme();
  for (const palette of ["BLACK_GOLD", "GRAPHITE_PEARL", "MIDNIGHT_BLUE"])
    for (const typography of ["STANDARD", "LARGE"])
      for (const density of ["STANDARD", "COMPACT", "AIRY"])
        for (const corners of ["SOFT", "SHARP", "ROUND"])
          expect(
            storefrontThemeSchema.safeParse({
              ...theme,
              palette,
              typography,
              density,
              corners,
            }).success,
          ).toBe(true);
  for (const value of [
    { ...theme, palette: "RED" },
    { ...theme, css: "body{}" },
    { ...theme, script: "alert(1)" },
    { ...theme, currency: "USD" },
    { ...theme, schemaVersion: 2 },
    { ...theme, typography: null },
    { ...theme, density: "TINY" },
    { ...theme, corners: 8 },
  ])
    expect(storefrontThemeSchema.safeParse(value).success).toBe(false);
});
test("mutations require version and idempotency; public responses cannot expose drafts or invented provenance", () => {
  expect(
    storefrontThemeCommandSchema.safeParse({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      theme: createDefaultStorefrontTheme(),
    }).success,
  ).toBe(false);
  const published = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_THEME",
    source: "DEFAULT",
    theme: createDefaultStorefrontTheme(),
    version: 0,
    publicationId: null,
  };
  expect(publicStorefrontThemeResponseSchema.safeParse(published).success).toBe(
    true,
  );
  expect(
    publicStorefrontThemeResponseSchema.safeParse({
      ...published,
      source: "PUBLISHED",
    }).success,
  ).toBe(false);
  expect(
    publicStorefrontThemeResponseSchema.safeParse({ ...published, draft: {} })
      .success,
  ).toBe(false);
});
test("preview messages have their own type and reject commerce payloads", () => {
  const message = {
    schemaVersion: 1,
    type: "STOREFRONT_THEME_PREVIEW",
    channel: "10000000-0000-4000-8000-000000000001",
    theme: createDefaultStorefrontTheme(),
  };
  expect(storefrontThemePreviewMessageSchema.safeParse(message).success).toBe(
    true,
  );
  expect(
    storefrontThemePreviewMessageSchema.safeParse({
      ...message,
      type: "HOME_LAYOUT_PREVIEW",
    }).success,
  ).toBe(false);
  expect(
    storefrontThemePreviewMessageSchema.safeParse({
      ...message,
      cartId: "private",
    }).success,
  ).toBe(false);
});
