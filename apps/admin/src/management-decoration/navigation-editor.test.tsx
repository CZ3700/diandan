import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { navigationFixture } from "./navigation-fixture";
const editor = await import("./navigation-editor").catch(() => undefined);
const labels = await import("./navigation-copy").catch(() => undefined);
test.each(SUPPORTED_LOCALES)(
  "%s navigation editing keeps core links and policies protected",
  (locale) => {
    expect(editor?.NavigationEditor).toBeTypeOf("function");
    expect(labels?.navigationCopy).toBeTypeOf("function");
    const copy = labels!.navigationCopy(locale);
    const NavigationEditor = editor!.NavigationEditor;
    const html = renderToStaticMarkup(
      <NavigationEditor
        navigation={navigationFixture()}
        disabled={false}
        onChange={() => {}}
        copy={copy}
      />,
    );
    expect(html.match(/data-navigation-header=/gu)).toHaveLength(3);
    expect(html.match(/data-navigation-footer=/gu)).toHaveLength(5);
    expect(html.match(/type="checkbox"/gu)).toHaveLength(5);
    expect(html).toMatch(/data-navigation-visible="POLICIES"[^>]*disabled/u);
    expect(html).toMatch(/data-navigation-up="header:HOME"[^>]*disabled/u);
    expect(html).toContain(copy.fixedControlsHint);
    expect(html).toContain(copy.regionHint);
    expect(html).not.toMatch(/undefined|\[object Object\]/u);
  },
);
