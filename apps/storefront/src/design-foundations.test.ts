import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { describe, expect, test } from "vitest";

type PreviewCase = Readonly<{
  accent: string;
  body: string;
  fontProfile: string;
  heading: string;
  label: string;
  locale: string;
  sample: string;
}>;

type DesignFoundationsModule = Readonly<{
  DESIGN_FOUNDATION_CASES: Readonly<Record<string, PreviewCase>>;
  isDesignFoundationPreviewEnabled: (value: unknown) => boolean;
}>;

async function loadDesignFoundations(): Promise<DesignFoundationsModule> {
  let loaded: unknown;
  try {
    loaded = await import("./design-foundations.js");
  } catch {
    loaded = undefined;
  }

  expect(
    loaded,
    "storefront design-foundations contract must exist",
  ).toBeDefined();
  return loaded as DesignFoundationsModule;
}

describe("internal design foundation cases", () => {
  test("covers the seven public locales plus one isolated pseudo-locale", async () => {
    const { DESIGN_FOUNDATION_CASES } = await loadDesignFoundations();

    expect(Object.keys(DESIGN_FOUNDATION_CASES).sort()).toEqual(
      [...SUPPORTED_LOCALES, "en-XA"].sort(),
    );
    expect(Object.isFrozen(DESIGN_FOUNDATION_CASES)).toBe(true);
    expect(DESIGN_FOUNDATION_CASES["en-XA"]?.fontProfile).toBe("latin");
    expect(JSON.stringify(DESIGN_FOUNDATION_CASES)).not.toMatch(
      /market|country|currency|payment/iu,
    );
  });

  test("includes real stress strings for combining marks, line breaking and expansion", async () => {
    const { DESIGN_FOUNDATION_CASES } = await loadDesignFoundations();
    const english = DESIGN_FOUNDATION_CASES["en"];
    const vietnamese = DESIGN_FOUNDATION_CASES["vi"];
    const thai = DESIGN_FOUNDATION_CASES["th"];
    const chinese = DESIGN_FOUNDATION_CASES["zh-CN"];
    const japanese = DESIGN_FOUNDATION_CASES["ja"];
    const spanish = DESIGN_FOUNDATION_CASES["es"];
    const portuguese = DESIGN_FOUNDATION_CASES["pt"];
    const pseudo = DESIGN_FOUNDATION_CASES["en-XA"];

    expect(english).toBeDefined();
    expect(vietnamese?.sample).toMatch(/[ăâđêôơư]/iu);
    expect(vietnamese?.sample.normalize("NFD")).not.toBe(vietnamese?.sample);
    expect(thai?.sample).toMatch(/[\u0E31-\u0E4E]/u);
    expect(chinese?.sample).toMatch(/[，。！？]/u);
    expect(japanese?.sample).toMatch(/[、。]/u);
    expect(spanish?.body.length).toBeGreaterThan(120);
    expect(portuguese?.body.length).toBeGreaterThan(120);
    expect(pseudo?.heading.length).toBeGreaterThan(
      (english?.heading.length ?? 0) * 1.4,
    );
  });
});

describe("design foundation route boundary", () => {
  test.each(["development", "test", "preview"])(
    "allows the internal specimen in %s",
    async (deploymentEnvironment) => {
      const { isDesignFoundationPreviewEnabled } =
        await loadDesignFoundations();

      expect(isDesignFoundationPreviewEnabled(deploymentEnvironment)).toBe(
        true,
      );
    },
  );

  test.each(["staging", "production", undefined, "PREVIEW"])(
    "fails closed for %j",
    async (deploymentEnvironment) => {
      const { isDesignFoundationPreviewEnabled } =
        await loadDesignFoundations();

      expect(isDesignFoundationPreviewEnabled(deploymentEnvironment)).toBe(
        false,
      );
    },
  );
});

test("uses a narrow-safe tokenized gap for every twelve-column canvas", async () => {
  const css = await readFile(
    fileURLToPath(
      new URL("./app/design-foundation-specimen.module.css", import.meta.url),
    ),
    "utf8",
  );

  expect(css.match(/column-gap: var\(--layout-column-gap\);/gu)).toHaveLength(
    2,
  );
  expect(css).not.toMatch(
    /grid-template-columns: repeat\(12,[\s\S]{0,180}gap: var\(--space-8\)/gu,
  );
});

test("does not force casing or display tracking onto Chinese, Japanese, or Thai copy", async () => {
  const css = await readFile(
    fileURLToPath(
      new URL("./app/design-foundation-specimen.module.css", import.meta.url),
    ),
    "utf8",
  );

  for (const profile of ["simplified-chinese", "japanese", "thai"]) {
    expect(css).toContain(`[data-font-profile="${profile}"] .eyebrow`);
    expect(css).toContain(`[data-font-profile="${profile}"] .poster h1`);
  }
  expect(css.match(/letter-spacing: normal;/gu)).toHaveLength(2);
  expect(css.match(/text-transform: none;/gu)).toHaveLength(1);
});
