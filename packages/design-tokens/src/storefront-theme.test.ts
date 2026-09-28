import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import * as tokens from "./index.js";

type ThemeExports = {
  storefrontThemeAttributes: (value: unknown) => Record<string, string>;
  STOREFRONT_THEME_PALETTES: Record<string, Record<string, string>>;
};
function subject() {
  const value = tokens as unknown as ThemeExports;
  expect(value.storefrontThemeAttributes).toBeTypeOf("function");
  expect(value.STOREFRONT_THEME_PALETTES).toBeDefined();
  return value;
}
const theme = {
  schemaVersion: 1,
  palette: "BLACK_GOLD",
  typography: "STANDARD",
  density: "STANDARD",
  corners: "SOFT",
};
test("theme exposes only deployed presentation attributes and rejects arbitrary style", () => {
  const { storefrontThemeAttributes } = subject();
  expect(storefrontThemeAttributes(theme)).toEqual({
    "data-storefront-palette": "BLACK_GOLD",
    "data-storefront-typography": "STANDARD",
    "data-storefront-density": "STANDARD",
    "data-storefront-corners": "SOFT",
    "data-storefront-hero-layout": "IMMERSIVE",
    "data-storefront-gift-layout": "GRID",
    "data-storefront-motion": "STANDARD",
    "data-storefront-motion-speed": "STANDARD",
    "data-storefront-artist-template": "IMMERSIVE",
    "data-storefront-gift-template": "IMAGE_LEFT",
  });
  expect(() =>
    storefrontThemeAttributes({ ...theme, css: "display:none" }),
  ).toThrow();
  expect(() =>
    storefrontThemeAttributes({ ...theme, palette: "url(example)" }),
  ).toThrow();
});
test("detail templates are independent of home presets and reset for legacy themes", () => {
  const { storefrontThemeAttributes } = subject();
  expect(
    storefrontThemeAttributes({
      ...theme,
      detailTemplates: { artist: "SPLIT", gift: "IMAGE_RIGHT" },
    }),
  ).toMatchObject({
    "data-storefront-artist-template": "SPLIT",
    "data-storefront-gift-template": "IMAGE_RIGHT",
    "data-storefront-hero-layout": "IMMERSIVE",
    "data-storefront-gift-layout": "GRID",
  });
  expect(storefrontThemeAttributes(theme)).toMatchObject({
    "data-storefront-artist-template": "IMMERSIVE",
    "data-storefront-gift-template": "IMAGE_LEFT",
  });
});
test("layout and motion attributes use one complete set and legacy themes reset them", () => {
  const { storefrontThemeAttributes } = subject();
  expect(
    storefrontThemeAttributes({
      ...theme,
      presentation: {
        heroLayout: "SPLIT",
        giftLayout: "SHOWCASE",
        motion: "SUBTLE",
        motionSpeed: "QUICK",
      },
    }),
  ).toMatchObject({
    "data-storefront-hero-layout": "SPLIT",
    "data-storefront-gift-layout": "SHOWCASE",
    "data-storefront-motion": "SUBTLE",
    "data-storefront-motion-speed": "QUICK",
  });
  expect(storefrontThemeAttributes(theme)).toMatchObject({
    "data-storefront-hero-layout": "IMMERSIVE",
    "data-storefront-gift-layout": "GRID",
    "data-storefront-motion": "STANDARD",
    "data-storefront-motion-speed": "STANDARD",
  });
});
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
test("every palette retains readable text, action and semantic states on all surfaces", () => {
  const { STOREFRONT_THEME_PALETTES } = subject();
  for (const palette of Object.values(STOREFRONT_THEME_PALETTES)) {
    for (const background of [
      "--color-bg",
      "--color-surface",
      "--color-surface-raised",
    ]) {
      for (const foreground of [
        "--color-text",
        "--color-text-muted",
        "--color-accent",
        "--color-success",
        "--color-danger",
        "--color-warning",
      ]) {
        const values = {
          ...tokens.DESIGN_TOKEN_CONTRACT.values,
          ...palette,
        } as Record<string, string>;
        const ratio =
          (luminance(values[foreground]!) + 0.05) /
          (luminance(values[background]!) + 0.05);
        expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    expect(
      Object.keys(palette).some((key) => /danger|success|warning/.test(key)),
    ).toBe(false);
  }
});
test("preset CSS agrees with palette tokens and keeps touch, fonts and reduced motion protected", async () => {
  const { STOREFRONT_THEME_PALETTES } = subject();
  const css = await readFile(
    new URL("../styles/storefront-theme.css", import.meta.url),
    "utf8",
  );
  for (const [name, palette] of Object.entries(STOREFRONT_THEME_PALETTES)) {
    if (name === "BLACK_GOLD") continue;
    const block = css.match(
      new RegExp(
        `html\\[data-storefront-palette="${name}"\\] \\{([^}]+)\\}`,
        "u",
      ),
    )?.[1];
    expect(block).toBeDefined();
    for (const [key, value] of Object.entries(palette))
      expect(block).toContain(`${key}: ${value};`);
  }
  expect(css).not.toMatch(/--(?:space-\d+|font-ui|motion-reduced)\s*:/u);
  expect(css).not.toMatch(/url\(|!important|animation:/u);
});
