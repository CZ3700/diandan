import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  createDefaultHomeLayout,
} from "@fan-support/contracts";
import { LayoutSectionEditor } from "./editor";
import { decorationCopy } from "./copy";
test.each(SUPPORTED_LOCALES)(
  "%s editor exposes keyboard controls, section labels and protected entry sections",
  (locale) => {
    const copy = decorationCopy(locale);
    const html = renderToStaticMarkup(
      <LayoutSectionEditor
        layout={createDefaultHomeLayout()}
        onChange={() => {}}
        disabled={false}
        copy={copy}
      />,
    );
    expect(html.match(/data-layout-section=/gu)).toHaveLength(8);
    expect(html.match(/type="checkbox"/gu)).toHaveLength(8);
    expect(html).toContain(
      `aria-label="${copy.moveUp}: ${copy.sections.GIFTS}"`,
    );
    expect(html).toMatch(/data-layout-visible="ARTISTS"[^>]*disabled/u);
    expect(html).not.toMatch(/undefined|\[object Object\]/u);
  },
);
