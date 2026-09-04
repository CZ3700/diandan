import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

type SpecimenModule = Readonly<{
  UiInteractionsSpecimen: (props: {
    locale: "en" | "en-XA" | "es" | "ja" | "pt" | "th" | "vi" | "zh-CN";
  }) => ReactElement;
}>;

async function loadSpecimen(): Promise<SpecimenModule> {
  let loaded: SpecimenModule | undefined;
  try {
    loaded = await import("./ui-interactions-specimen.js");
  } catch {
    loaded = undefined;
  }
  expect(
    loaded,
    "the gated P2-03 interaction specimen must exist",
  ).toBeDefined();
  return loaded as SpecimenModule;
}

test("renders the five interaction workspaces with locale-scoped copy", async () => {
  const { UiInteractionsSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    <UiInteractionsSpecimen locale="zh-CN" />,
  );

  expect(markup).toContain('data-ui-interactions="v1"');
  expect(markup).toContain('lang="zh-CN"');
  for (const workspace of [
    "dialog",
    "drawer",
    "menu",
    "toast",
    "locale-region",
  ]) {
    expect(markup).toContain(`data-interaction-workspace="${workspace}"`);
  }
  expect(markup).toContain("更改展示语言不会重建购物车或支付状态");
  expect(markup).toContain("简体中文");
  expect(markup).toContain("United States");
});

test("keeps pseudo-locale stress copy internal while language choices stay canonical", async () => {
  const { UiInteractionsSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    <UiInteractionsSpecimen locale="en-XA" />,
  );

  expect(markup).toContain('lang="en-XA"');
  expect(markup).toContain("[!! Ïñţëřàçţïöñ ļàÿëřš ŵïţħ ëxpàñđëđ ļàbëļš !!]");
  expect(markup).toContain("English");
  const controls = markup.match(
    /<div class="[^"]*controlGrid[^"]*">([\s\S]*?)<\/div>/u,
  );
  expect(controls?.[1]).not.toContain("en-XA");
});

test("keeps internal fixture metadata in English and marks it no customer content", async () => {
  const { UiInteractionsSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(<UiInteractionsSpecimen locale="th" />);

  expect(markup).toMatch(/<header(?=[^>]*lang="en")[^>]*>/u);
  expect(markup).toContain("Foundation 04 / interaction layers");
  expect(markup).toContain("Internal specimen — not customer content");
});
