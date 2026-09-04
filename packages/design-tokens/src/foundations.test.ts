import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { describe, expect, test } from "vitest";

type UnknownRecord = Readonly<Record<string, unknown>>;

type DesignTokenContract = Readonly<{
  schemaVersion: 1;
  breakpoints: Readonly<{
    desktop: "64rem";
    tablet: "48rem";
  }>;
  runtimeDefaults: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
}>;

type FontProfile = Readonly<{
  cssModule: string;
  family: string;
  id: string;
  script: string;
}>;

type AccentResolution = Readonly<{
  accent: string;
  contrastRatio: number;
  fallbackUsed: boolean;
  schemaVersion: 1;
  style: Readonly<Record<string, string>>;
}>;

const expectedTokenValues = Object.freeze({
  "--border-width": "0.0625rem",
  "--color-accent": "#d8b26e",
  "--color-bg": "#0a0a0c",
  "--color-border": "rgb(255 255 255 / 12%)",
  "--color-danger": "#ea7373",
  "--color-success": "#63c98d",
  "--color-surface": "#121216",
  "--color-surface-raised": "#19191f",
  "--color-text": "#f6f3ee",
  "--color-text-muted": "#aaa6a0",
  "--color-warning": "#e5aa55",
  "--ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--focus-ring-offset": "0.25rem",
  "--focus-ring-width": "0.1875rem",
  "--layout-canvas-max": "90rem",
  "--layout-column-gap": "clamp(0.5rem, 1.5vw, 1.5rem)",
  "--layout-content-max": "75rem",
  "--layout-gutter-desktop": "3rem",
  "--layout-gutter-mobile": "1rem",
  "--layout-gutter-tablet": "1.5rem",
  "--layout-min-width": "20rem",
  "--layout-reading-max": "65ch",
  "--link-underline-offset": "0.2em",
  "--motion-control": "220ms",
  "--motion-fast": "120ms",
  "--motion-hero": "720ms",
  "--motion-layout": "360ms",
  "--motion-reduced": "0ms",
  "--radius-control": "0.75rem",
  "--radius-media": "1.25rem",
  "--radius-pill": "999px",
  "--space-1": "0.25rem",
  "--space-12": "3rem",
  "--space-16": "4rem",
  "--space-2": "0.5rem",
  "--space-24": "6rem",
  "--space-3": "0.75rem",
  "--space-32": "8rem",
  "--space-4": "1rem",
  "--space-6": "1.5rem",
  "--space-8": "2rem",
  "--shadow-raised": "0 1rem 3rem rgb(0 0 0 / 24%)",
  "--type-body-leading": "1.6",
  "--type-body-size": "clamp(1rem, 0.96rem + 0.2vw, 1.125rem)",
  "--type-display-leading": "0.96",
  "--type-display-script-leading": "1.15",
  "--type-display-size": "clamp(2.75rem, 1.4rem + 6.75vw, 7.5rem)",
  "--type-display-tracking": "-0.04em",
  "--type-heading-leading": "1.06",
  "--type-heading-script-leading": "1.15",
  "--type-heading-size": "clamp(2rem, 1.45rem + 2.75vw, 4rem)",
  "--type-label-size": "0.75rem",
  "--type-label-tracking": "0.12em",
} as const);

const expectedRuntimeDefaults = Object.freeze({
  "--font-ui": "system-ui, sans-serif",
  "--idol-accent": "var(--color-accent)",
  "--layout-gutter": "var(--layout-gutter-mobile)",
  "--motion-control-effective": "var(--motion-control)",
  "--motion-fast-effective": "var(--motion-fast)",
  "--motion-hero-effective": "var(--motion-hero)",
  "--motion-layout-effective": "var(--motion-layout)",
} as const);

async function loadFoundations(): Promise<UnknownRecord> {
  return (await import("./index.js")) as UnknownRecord;
}

function requiredExport<T>(module: UnknownRecord, name: string): T {
  const value = module[name];
  expect(value, `${name} must be exported`).toBeDefined();
  return value as T;
}

async function readPackageFile(
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(
      fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
      "utf8",
    );
  } catch {
    return undefined;
  }
}

describe("design token contract", () => {
  test("locks the approved default palette, scale, motion, type and layout values", async () => {
    const foundations = await loadFoundations();
    const contract = requiredExport<DesignTokenContract>(
      foundations,
      "DESIGN_TOKEN_CONTRACT",
    );

    expect(contract).toEqual({
      schemaVersion: 1,
      breakpoints: { desktop: "64rem", tablet: "48rem" },
      runtimeDefaults: expectedRuntimeDefaults,
      values: expectedTokenValues,
    });
    expect(JSON.parse(JSON.stringify(contract))).toEqual(contract);
  });

  test("keeps the checked-in CSS synchronized with the token contract", async () => {
    const foundations = await loadFoundations();
    const contract = requiredExport<DesignTokenContract>(
      foundations,
      "DESIGN_TOKEN_CONTRACT",
    );
    const css = await readPackageFile("styles/foundations.css");

    expect(css, "shared foundations.css must exist").toBeDefined();
    for (const [name, value] of Object.entries(contract.values)) {
      expect(css).toContain(`${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(contract.runtimeDefaults)) {
      expect(css).toContain(`${name}: ${value};`);
    }
    expect(css).not.toContain("--idol-on-accent");
    expect(css).toContain("@media (min-width: 48rem)");
    expect(css).toContain("@media (min-width: 64rem)");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

describe("locale font profiles", () => {
  test("maps every public locale to one independent script profile", async () => {
    const foundations = await loadFoundations();
    const byLocale = requiredExport<Readonly<Record<string, FontProfile>>>(
      foundations,
      "FONT_PROFILE_BY_LOCALE",
    );

    expect(Object.keys(byLocale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(Object.isFrozen(byLocale)).toBe(true);
    expect(byLocale["en"]).toEqual({
      cssModule: "@fan-support/design-tokens/fonts/latin.css",
      family: "Manrope Variable",
      id: "latin",
      script: "Latn",
    });
    expect(byLocale["es"]).toBe(byLocale["en"]);
    expect(byLocale["pt"]).toBe(byLocale["en"]);
    expect(byLocale["ja"]).toEqual({
      cssModule: "@fan-support/design-tokens/fonts/japanese.css",
      family: "Noto Sans JP Variable",
      id: "japanese",
      script: "Jpan",
    });
    expect(byLocale["th"]).toEqual({
      cssModule: "@fan-support/design-tokens/fonts/thai.css",
      family: "Noto Sans Thai Variable",
      id: "thai",
      script: "Thai",
    });
    expect(byLocale["vi"]).toEqual({
      cssModule: "@fan-support/design-tokens/fonts/vietnamese.css",
      family: "Manrope Variable",
      id: "vietnamese",
      script: "Latn",
    });
    expect(byLocale["zh-CN"]).toEqual({
      cssModule: "@fan-support/design-tokens/fonts/simplified-chinese.css",
      family: "Noto Sans SC Variable",
      id: "simplified-chinese",
      script: "Hans",
    });
    expect(JSON.stringify(byLocale)).not.toMatch(
      /market|country|currency|payment/iu,
    );
  });

  test.each([
    ["latin.css", "@fontsource-variable/manrope/wght.css"],
    ["vietnamese.css", "@fontsource-variable/manrope/wght.css"],
    ["simplified-chinese.css", "@fontsource-variable/noto-sans-sc/wght.css"],
    ["japanese.css", "@fontsource-variable/noto-sans-jp/wght.css"],
    ["thai.css", "@fontsource-variable/noto-sans-thai/wght.css"],
  ])(
    "keeps %s self-hosted and profile-specific",
    async (fileName, fontImport) => {
      const css = await readPackageFile(`styles/fonts/${fileName}`);

      expect(css, `${fileName} must exist`).toBeDefined();
      expect(css).toContain(fontImport);
      expect(css).not.toMatch(/https?:\/\//u);
    },
  );
});

describe("idol accent protection", () => {
  test("accepts a visible six-digit hex accent and exposes only scoped CSS variables", async () => {
    const foundations = await loadFoundations();
    const resolveIdolAccent = requiredExport<
      (input: unknown) => AccentResolution
    >(foundations, "resolveIdolAccent");

    const result = resolveIdolAccent("#6888BD");

    expect(result.schemaVersion).toBe(1);
    expect(result.accent).toBe("#6888bd");
    expect(result.fallbackUsed).toBe(false);
    expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5);
    expect(Object.keys(result.style)).toEqual(["--idol-accent"]);
    expect(result.style["--idol-accent"]).toBe(result.accent);
  });

  test.each([
    "#101014",
    "#5373A8",
    "#5B7DB3",
    "red",
    "#fff",
    "#d8b26e;--color-danger:#fff",
    null,
  ])(
    "falls back without allowing semantic token injection for %j",
    async (input) => {
      const foundations = await loadFoundations();
      const resolveIdolAccent = requiredExport<
        (input: unknown) => AccentResolution
      >(foundations, "resolveIdolAccent");

      const result = resolveIdolAccent(input);

      expect(result.accent).toBe("#d8b26e");
      expect(result.fallbackUsed).toBe(true);
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(JSON.stringify(result.style)).not.toMatch(
        /danger|success|warning|payment/iu,
      );
    },
  );
});
