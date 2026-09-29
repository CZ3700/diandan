import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import * as tokens from "./index.js";

type ThemeExports = {
  storefrontThemeAttributes: (value: unknown) => Record<string, string>;
  STOREFRONT_THEME_PALETTES: Record<string, Record<string, string>>;
  STOREFRONT_PALETTE_SCHEMES: Record<string, "DARK" | "LIGHT">;
};
function subject() {
  const value = tokens as unknown as ThemeExports;
  expect(value.storefrontThemeAttributes).toBeTypeOf("function");
  expect(value.STOREFRONT_THEME_PALETTES).toBeDefined();
  expect(value.STOREFRONT_PALETTE_SCHEMES).toBeDefined();
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
    "data-storefront-scheme": "DARK",
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
function contrast(left: string, right: string) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}
function hue(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta === 0) return 0;
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (sector * 60 + 360) % 360;
}
const LIGHT_PALETTES = ["SAKURA_PINK", "SKY_BLUE", "IVORY_GOLD", "PEARL_GRAY"];
const FEEDBACK = ["--color-danger", "--color-success", "--color-warning"];
test("each palette declares its scheme: three dark presets, then four light presets (L2-16)", () => {
  const { STOREFRONT_PALETTE_SCHEMES, STOREFRONT_THEME_PALETTES } = subject();
  expect(STOREFRONT_PALETTE_SCHEMES).toEqual({
    BLACK_GOLD: "DARK",
    GRAPHITE_PEARL: "DARK",
    MIDNIGHT_BLUE: "DARK",
    SAKURA_PINK: "LIGHT",
    SKY_BLUE: "LIGHT",
    IVORY_GOLD: "LIGHT",
    PEARL_GRAY: "LIGHT",
  });
  expect(Object.keys(STOREFRONT_THEME_PALETTES)).toEqual(
    Object.keys(STOREFRONT_PALETTE_SCHEMES),
  );
});
test("light palettes switch the scheme attribute; dark palettes keep it", () => {
  const { storefrontThemeAttributes, STOREFRONT_PALETTE_SCHEMES } = subject();
  for (const [palette, scheme] of Object.entries(STOREFRONT_PALETTE_SCHEMES))
    expect(storefrontThemeAttributes({ ...theme, palette })).toMatchObject({
      "data-storefront-palette": palette,
      "data-storefront-scheme": scheme,
    });
});
test("every palette retains readable text, action and semantic states on all surfaces", () => {
  const { STOREFRONT_THEME_PALETTES } = subject();
  for (const [name, palette] of Object.entries(STOREFRONT_THEME_PALETTES)) {
    const values = {
      ...tokens.DESIGN_TOKEN_CONTRACT.values,
      ...palette,
    } as Record<string, string>;
    for (const background of [
      "--color-bg",
      "--color-surface",
      "--color-surface-raised",
    ]) {
      for (const foreground of [
        "--color-text",
        "--color-text-muted",
        "--color-accent",
        ...FEEDBACK,
      ]) {
        expect(
          contrast(values[foreground]!, values[background]!),
          `${name} ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Text is lighter than the page on dark palettes and darker on light ones.
    expect(
      luminance(values["--color-text"]!) > luminance(values["--color-bg"]!),
      `${name} scheme direction`,
    ).toBe(!LIGHT_PALETTES.includes(name));
  }
});
test("dark palettes never retune semantic states; light palettes carry a complete set that keeps its meaning", () => {
  const { STOREFRONT_THEME_PALETTES } = subject();
  for (const [name, palette] of Object.entries(STOREFRONT_THEME_PALETTES)) {
    const overrides = Object.keys(palette).filter((key) =>
      /danger|success|warning|border|shadow/.test(key),
    );
    if (!LIGHT_PALETTES.includes(name)) {
      expect(overrides, name).toEqual([]);
      continue;
    }
    expect(overrides.sort(), name).toEqual(
      [...FEEDBACK, "--color-border", "--shadow-raised"].sort(),
    );
    const danger = hue(palette["--color-danger"]!);
    expect(danger < 15 || danger > 345, `${name} danger stays red`).toBe(true);
    const success = hue(palette["--color-success"]!);
    expect(success > 100 && success < 170, `${name} success stays green`).toBe(
      true,
    );
    const warning = hue(palette["--color-warning"]!);
    expect(warning > 25 && warning < 50, `${name} warning stays amber`).toBe(
      true,
    );
    expect(palette["--color-border"]).toMatch(/^rgb\(\d+ \d+ \d+ \/ \d+%\)$/u);
    expect(palette["--shadow-raised"]).toMatch(
      /^0 1rem 3rem rgb\(\d+ \d+ \d+ \/ \d+%\)$/u,
    );
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
  // Native controls, scrollbars and autofill follow the page on light palettes.
  expect(css).toMatch(
    /html\[data-storefront-scheme="LIGHT"\] \{\s*color-scheme: light;\s*\}/u,
  );
  expect(css).not.toMatch(/--(?:space-\d+|font-ui|motion-reduced)\s*:/u);
  expect(css).not.toMatch(/url\(|!important|animation:/u);
});
