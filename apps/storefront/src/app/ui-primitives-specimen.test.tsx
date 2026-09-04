import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

type SpecimenModule = Readonly<{
  UiPrimitivesSpecimen: (props: {
    locale: "en" | "en-XA" | "es" | "ja" | "pt" | "th" | "vi" | "zh-CN";
  }) => ReactElement;
}>;

async function loadSpecimen(): Promise<SpecimenModule> {
  return import("./ui-primitives-specimen.js");
}

test("renders all eight primitives as an internal, locale-scoped specimen", async () => {
  const { UiPrimitivesSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    UiPrimitivesSpecimen({ locale: "zh-CN" }),
  );

  expect(markup).toContain('data-ui-primitives="v1"');
  expect(markup).toContain('lang="zh-CN"');
  for (const primitive of [
    "fs-button",
    "fs-link",
    "fs-icon",
    "fs-media",
    "fs-price",
    "fs-status",
    "fs-field",
    "fs-quantity",
  ]) {
    expect(markup).toContain(primitive);
  }
  expect(markup).toContain("把完整留言保留在安全流程中");
});

test("preserves deliberately expanded pseudo-locale content without truncation", async () => {
  const { UiPrimitivesSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    UiPrimitivesSpecimen({ locale: "en-XA" }),
  );

  expect(markup).toContain('lang="en-XA"');
  expect(markup).toContain(
    "[!! Çöñţïñüë ŵïţħ à đëļïbëřàţëļÿ ëxpàñđëđ àçţïöñ ļàbëļ !!]",
  );
  expect(markup).toContain(
    "[!! Pļëàšë këëp ţħïš ëxpàñđëđ ħëļp àñđ ëřřöř ţëxţ füļļÿ vïšïbļë !!]",
  );
});

test("uses an explicit rtl structure probe without inventing a public locale", async () => {
  const { UiPrimitivesSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(UiPrimitivesSpecimen({ locale: "en" }));

  const rtlSection = markup.match(
    /<section(?=[^>]*dir="rtl")(?=[^>]*data-rtl-probe="true")[^>]*>/u,
  );
  expect(rtlSection).not.toBeNull();
  expect(markup).not.toContain('lang="ar"');
  expect(markup).not.toContain('lang="ar-XB"');
});

test("marks internal English copy and hides the duplicated specimen icon", async () => {
  const { UiPrimitivesSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    UiPrimitivesSpecimen({ locale: "zh-CN" }),
  );

  expect(markup).toMatch(/<header(?=[^>]*lang="en")[^>]*>/u);
  expect(markup).toMatch(
    /<p(?=[^>]*lang="en")[^>]*>Internal interaction specimen<\/p>/u,
  );
  for (const heading of [
    "Navigation, price and status",
    "Button states",
    "Media states",
    "Field and quantity",
    "RTL structure probe",
  ]) {
    expect(markup).toMatch(
      new RegExp(`<h2(?=[^>]*lang="en")[^>]*>${heading}</h2>`, "u"),
    );
  }
  expect(markup).toMatch(/<footer(?=[^>]*lang="en")[^>]*>/u);
  expect(markup).toMatch(
    /<svg(?=[^>]*aria-hidden="true")(?=[^>]*class="fs-icon")[^>]*>/u,
  );
  expect(markup).not.toContain('role="img"');
});
