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
  });
  expect(() =>
    storefrontThemeAttributes({ ...theme, css: "display:none" }),
  ).toThrow();
  expect(() =>
    storefrontThemeAttributes({ ...theme, palette: "url(example)" }),
  ).toThrow();
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
test("preset CSS agrees with palette tokens and never changes touch, fonts or motion", async () => {
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
  expect(css).not.toMatch(/--(?:space-\d+|font-ui|motion-[\w-]+)\s*:/u);
  expect(css).not.toMatch(/url\(|!important|animation:/u);
});
