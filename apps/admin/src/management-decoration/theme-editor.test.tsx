import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
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
    expect(html.match(/<select/gu)).toHaveLength(3);
    expect(html).toContain("<details");
    expect(html).toContain("data-theme-editor");
    expect(html).toContain('<fieldset disabled=""');
    expect(html).not.toMatch(/undefined|\[object Object\]/u);
  },
);
