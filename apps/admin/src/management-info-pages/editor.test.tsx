import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const subject = await import("./editor").catch(() => undefined);
const labels = await import("./copy").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
for (const locale of SUPPORTED_LOCALES)
  test(`${locale} information editor has short source fields and support-only contact`, () => {
    expect(subject?.InformationEditor).toBeTypeOf("function");
    expect(labels?.informationCopy).toBeTypeOf("function");
    const copy = labels!.informationCopy(locale);
    for (const pageKey of ["ABOUT", "FAQ", "SUPPORT"] as const) {
      const html = renderToStaticMarkup(
        createElement(subject!.InformationEditor, {
          pageKey,
          contentLocale: "en",
          draft: {
            structure: { sectionIds: [id], contactEmail: null },
            fields: {
              title: "Title",
              summary: "Summary",
              sections: [{ id, heading: "Heading", body: "Body" }],
            },
          },
          disabled: false,
          onChange: vi.fn(),
          copy,
        }),
      );
      expect(html).toContain('data-info-field="title"');
      expect(html).toContain('data-info-field="summary"');
      expect(html).toContain("data-info-section=");
      expect(html.includes("data-info-contact")).toBe(pageKey === "SUPPORT");
      expect(html).not.toContain("undefined");
    }
  });
