import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { fields } from "./fixture";
import { policiesCopy } from "./copy";
const subject = await import("./editor").catch(() => undefined);
test("policy editor has schema limits, explicit provenance and UTC effective time", () => {
  expect(subject?.PolicyEditor).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    createElement(subject!.PolicyEditor, {
      copy: policiesCopy("en"),
      locale: "en",
      draft: {
        kind: "DELIVERY",
        effectiveAt: "2027-01-01T00:00:00Z",
        translations: [{ locale: "en", origin: "MACHINE", fields }],
      },
      disabled: false,
      canStructure: true,
      onChange: () => {},
    }),
  );
  expect(html).toContain('maxLength="160"');
  expect(html).toContain('maxLength="300"');
  expect(html).toContain('maxLength="20000"');
  expect(html).toContain('value="MACHINE" selected=""');
  expect(html).toContain("UTC");
});
