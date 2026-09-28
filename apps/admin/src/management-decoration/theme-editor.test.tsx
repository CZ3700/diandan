import { expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  createDefaultStorefrontTheme,
} from "@fan-support/contracts";
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
    expect(html.match(/type="radio"/gu)).toHaveLength(3);
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

function control(
  node: unknown,
  field: string,
): ReactElement<{ onChange: (event: unknown) => void }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = control(child, field);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.props["data-theme-setting"] === field)
    return node as ReactElement<{ onChange: (event: unknown) => void }>;
  return control(node.props["children"], field);
}

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
