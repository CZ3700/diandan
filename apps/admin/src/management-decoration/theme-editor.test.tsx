import { expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  createDefaultStorefrontTheme,
} from "@fan-support/contracts";
import { STOREFRONT_THEME_PALETTES } from "@fan-support/design-tokens";
const editor = await import("./theme-editor").catch(() => undefined);
const copyModule = await import("./theme-copy").catch(() => undefined);
test.each(SUPPORTED_LOCALES)(
  "%s theme controls keep all presets labeled and read-only accounts disabled",
  (locale) => {
    expect(editor?.ThemeEditor).toBeTypeOf("function");
    expect(copyModule?.themeCopy).toBeTypeOf("function");
    const ThemeEditor = editor!.ThemeEditor;
    const html = renderToStaticMarkup(
      <ThemeEditor
        theme={{
          schemaVersion: 1,
          palette: "BLACK_GOLD",
          typography: "STANDARD",
          density: "STANDARD",
          corners: "SOFT",
        }}
        onChange={() => {}}
        disabled
        copy={copyModule!.themeCopy(locale)}
      />,
    );
    expect(html.match(/data-theme-palette=/gu)).toHaveLength(7);
    expect(html.match(/<select/gu)).toHaveLength(9);
    expect(html.match(/<details/gu)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*\bopen/u);
    for (const field of [
      "heroLayout",
      "giftLayout",
      "artistTemplate",
      "giftTemplate",
      "motion",
      "motionSpeed",
    ])
      expect(html).toMatch(
        new RegExp(`data-theme-setting="${field}"[^>]*disabled`, "u"),
      );
    expect(html).toContain("data-theme-editor");
    expect(html).toContain('<fieldset disabled=""');
    expect(html).not.toMatch(/undefined|\[object Object\]/u);
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s palettes are grouped dark then light, each with a token swatch and its own name (L2-16)",
  (locale) => {
    const ThemeEditor = editor!.ThemeEditor;
    const copy = copyModule!.themeCopy(locale);
    const html = renderToStaticMarkup(
      <ThemeEditor
        theme={{ ...createDefaultStorefrontTheme(), palette: "IVORY_GOLD" }}
        onChange={() => {}}
        disabled={false}
        copy={copy}
      />,
    );
    const groups = [
      ...html.matchAll(
        /<fieldset data-palette-group="(DARK|LIGHT)"><legend>([^<]+)<\/legend>(.*?)<\/fieldset>/gu,
      ),
    ];
    expect(groups.map((group) => group[1])).toEqual(["DARK", "LIGHT"]);
    expect(groups.map((group) => group[2])).toEqual([
      copy.paletteGroups.DARK,
      copy.paletteGroups.LIGHT,
    ]);
    const options = groups.map((group) =>
      [...group[3]!.matchAll(/data-theme-palette="([A-Z_]+)"/gu)].map(
        (match) => match[1],
      ),
    );
    expect(options).toEqual([
      ["BLACK_GOLD", "GRAPHITE_PEARL", "MIDNIGHT_BLUE"],
      ["SAKURA_PINK", "SKY_BLUE", "IVORY_GOLD", "PEARL_GRAY"],
    ]);
    for (const [palette, tokens] of Object.entries(STOREFRONT_THEME_PALETTES)) {
      const option = html.match(
        new RegExp(
          `data-theme-palette="${palette}"[^>]*/><span class="decoration-theme-swatch" aria-hidden="true" style="([^"]+)"></span><span>([^<]+)</span>`,
          "u",
        ),
      );
      expect(option, `${locale} ${palette}`).not.toBeNull();
      for (const token of ["--color-bg", "--color-text", "--color-accent"])
        expect(option![1]).toContain(
          `--swatch-${token.slice("--color-".length)}:${tokens[token as keyof typeof tokens]}`,
        );
      expect(option![2]).toBe(
        copy.palettes[palette as keyof typeof copy.palettes].replaceAll(
          "&",
          "&amp;",
        ),
      );
    }
    expect(new Set(Object.values(copy.palettes)).size).toBe(7);
    expect(html).toMatch(/data-theme-palette="IVORY_GOLD"[^>]*checked/u);
    expect(
      html.match(/data-theme-palette="[A-Z_]+"[^>]*checked/gu),
    ).toHaveLength(1);
  },
);

function control(
  node: unknown,
  field: string,
  value?: string,
): ReactElement<{ onChange: (event: unknown) => void }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = control(child, field, value);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (
    node.props["data-theme-setting"] === field &&
    (value === undefined || node.props["value"] === value)
  )
    return node as ReactElement<{ onChange: (event: unknown) => void }>;
  return control(node.props["children"], field, value);
}

test.each(SUPPORTED_LOCALES)(
  "%s shows four labeled hero effects outside advanced settings",
  (locale) => {
    const copy = copyModule!.themeCopy(locale);
    const onChange = vi.fn();
    const theme = createDefaultStorefrontTheme();
    const html = renderToStaticMarkup(
      editor!.ThemeEditor({ theme, onChange, disabled: true, copy }),
    );
    expect(html).toContain("data-theme-effect-picker");
    const picker = html.match(
      /<fieldset[^>]*data-theme-effect-picker[^>]*>(.*?)<\/fieldset>/u,
    );
    expect(picker).not.toBeNull();
    expect(picker![0]).toContain('disabled=""');
    expect(html.indexOf("data-theme-effect-picker")).toBeLessThan(
      html.indexOf("<details"),
    );
    for (const effect of ["STARLIGHT", "AURORA", "SPOTLIGHT", "PETALS"])
      expect(picker![0]).toContain(`value="${effect}"`);
    expect(new Set(Object.values(copy.heroEffectOptions)).size).toBe(4);
    for (const label of Object.values(copy.heroEffectOptions))
      expect(picker![0]).toContain(label);
    expect(picker![0]).toMatch(
      /<input(?=[^>]*value="STARLIGHT")(?=[^>]*checked)[^>]*>/u,
    );
    expect(picker![0].match(/type="radio"/gu)).toHaveLength(4);
    expect(picker![0]).not.toMatch(/undefined|\[object Object\]/u);
    expect(onChange).not.toHaveBeenCalled();
    expect(theme).not.toHaveProperty("presentation");
  },
);

test.each(["STARLIGHT", "AURORA", "SPOTLIGHT", "PETALS"] as const)(
  "selecting %s keeps all other theme settings",
  (heroEffect) => {
    const theme = {
      ...createDefaultStorefrontTheme(),
      palette: "SKY_BLUE" as const,
      presentation: {
        heroLayout: "SPLIT" as const,
        giftLayout: "SHOWCASE" as const,
        motion: "SUBTLE" as const,
        motionSpeed: "QUICK" as const,
      },
    };
    const onChange = vi.fn();
    const tree = editor!.ThemeEditor({
      theme,
      onChange,
      disabled: false,
      copy: copyModule!.themeCopy("en"),
    });
    const option = control(tree, "heroEffect", heroEffect);
    expect(option).toBeDefined();
    option!.props.onChange({ currentTarget: { value: heroEffect } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...theme,
      presentation: { ...theme.presentation, heroEffect },
    });
  },
);

test.each([
  ["motion", "NONE"],
  ["motionSpeed", "QUICK"],
  ["heroLayout", "SPLIT"],
  ["artistTemplate", "SPLIT"],
  ["density", "COMPACT"],
] as const)(
  "changing %s preserves the selected hero effect",
  (field, value) => {
    const theme = {
      ...createDefaultStorefrontTheme(),
      presentation: {
        heroLayout: "IMMERSIVE" as const,
        giftLayout: "GRID" as const,
        motion: "STANDARD" as const,
        motionSpeed: "STANDARD" as const,
        heroEffect: "AURORA" as const,
      },
    };
    const onChange = vi.fn();
    const tree = editor!.ThemeEditor({
      theme,
      onChange,
      disabled: false,
      copy: copyModule!.themeCopy("en"),
    });
    control(tree, field)!.props.onChange({ currentTarget: { value } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0].presentation.heroEffect).toBe("AURORA");
  },
);

test("legacy themes show presentation defaults without silently rewriting their saved shape", () => {
  const theme = createDefaultStorefrontTheme();
  const onChange = vi.fn();
  const result = editor!.ThemeEditor({
    theme,
    onChange,
    disabled: false,
    copy: copyModule!.themeCopy("zh-CN"),
  });
  const html = renderToStaticMarkup(result);
  expect(html).toContain('value="IMMERSIVE" selected=""');
  expect(html).toContain('value="GRID" selected=""');
  expect(html).toContain("首页海报布局");
  expect(html).toContain("礼物展示");
  expect(html).toContain("动效速度");
  expect(onChange).not.toHaveBeenCalled();
  expect(theme).not.toHaveProperty("presentation");
  expect(control(result, "heroLayout")).toBeDefined();
  control(result, "heroLayout")!.props.onChange({
    currentTarget: { value: "SPLIT" },
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    ...theme,
    presentation: {
      heroLayout: "SPLIT",
      giftLayout: "GRID",
      motion: "STANDARD",
      motionSpeed: "STANDARD",
    },
  });
  expect(theme).not.toHaveProperty("presentation");
});

test("motion off disables only its speed and preserves the chosen speed", () => {
  const theme = {
    ...createDefaultStorefrontTheme(),
    presentation: {
      heroLayout: "SPLIT" as const,
      giftLayout: "SHOWCASE" as const,
      motion: "NONE" as const,
      motionSpeed: "QUICK" as const,
    },
  };
  const onChange = vi.fn();
  const result = editor!.ThemeEditor({
    theme,
    onChange,
    disabled: false,
    copy: copyModule!.themeCopy("en"),
  });
  const html = renderToStaticMarkup(result);
  expect(html).toMatch(/data-theme-setting="motionSpeed"[^>]*disabled/u);
  expect(html).not.toMatch(/data-theme-setting="motion"[^>]*disabled/u);
  expect(html).toContain('value="QUICK" selected=""');
  expect(control(result, "motion")).toBeDefined();
  control(result, "motion")!.props.onChange({
    currentTarget: { value: "SUBTLE" },
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    ...theme,
    presentation: { ...theme.presentation, motion: "SUBTLE" },
  });
});

test.each([
  ["artistTemplate", "SPLIT", { artist: "SPLIT", gift: "IMAGE_LEFT" }],
  ["giftTemplate", "IMAGE_RIGHT", { artist: "IMMERSIVE", gift: "IMAGE_RIGHT" }],
] as const)(
  "%s changes only detail templates and keeps legacy presentation absent",
  (field, value, detailTemplates) => {
    const theme = createDefaultStorefrontTheme();
    const onChange = vi.fn();
    const result = editor!.ThemeEditor({
      theme,
      onChange,
      disabled: false,
      copy: copyModule!.themeCopy("zh-CN"),
    });
    const html = renderToStaticMarkup(result);
    expect(html).toContain("艺人详情布局");
    expect(html).toContain("礼物详情布局");
    expect(html).toContain('value="IMAGE_LEFT" selected=""');
    expect(onChange).not.toHaveBeenCalled();
    expect(theme).not.toHaveProperty("detailTemplates");
    expect(control(result, field)).toBeDefined();
    control(result, field)!.props.onChange({ currentTarget: { value } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...theme,
      detailTemplates,
    });
    expect(theme).not.toHaveProperty("detailTemplates");
    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty("presentation");
  },
);
