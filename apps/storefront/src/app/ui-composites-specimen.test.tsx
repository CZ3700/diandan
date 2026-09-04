import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import * as specimen from "./ui-composites-specimen.js";
import { uiCompositesCopyForLocale } from "./ui-composites-copy.js";

type SpecimenLocale = Parameters<
  typeof specimen.UiCompositesSpecimen
>[0]["locale"];

function renderSpecimen(locale: SpecimenLocale): string {
  return renderToStaticMarkup(
    <specimen.UiCompositesSpecimen locale={locale} />,
  );
}

test("renders all six composites in the preview-only locale specimen", () => {
  const markup = renderSpecimen("zh-CN");

  expect(markup).toContain('data-ui-composites="v1"');
  expect(markup).toContain('lang="zh-CN"');
  for (const composite of [
    "hero",
    "idol-portrait",
    "gift-tile",
    "idol-context",
    "cart-line",
    "order-timeline",
  ]) {
    expect(markup).toContain(`data-fs-composite="${composite}"`);
  }
  expect(markup).toContain("送给 Mira Vale");
  expect(markup).toContain("已添加私密留言");
});

test("shows loading, empty, error, unavailable and real image-failure probes", () => {
  const markup = renderSpecimen("en");

  for (const state of ["loading", "empty", "error"] as const) {
    expect(markup).toContain(`data-render-state="${state}"`);
  }
  expect(markup).toContain('data-availability="unavailable"');
  expect(markup).toContain('data-availability="low-stock"');
  expect(markup.match(/data:image\/png;base64,AA==/gu)).toHaveLength(4);
  expect(markup).toContain('data-hero-transition-demo="loading"');
  expect(markup).toContain('data-hero-transition-trigger="true"');
  expect(markup).toContain('data-hero-failure-demo="ready"');
  expect(markup).toContain('data-hero-failure-trigger="true"');
});

test("preserves long Portuguese and expanded pseudo-locale copy", () => {
  const portuguese = renderSpecimen("pt");
  const pseudo = renderSpecimen("en-XA");

  expect(portuguese).toContain(
    "Escolher este presente de apoio cuidadosamente preparado",
  );
  expect(pseudo).toContain("[!! Çħööšë à çàřëfüļļÿ přëpàřëđ šüppöřţ ğïfţ !!]");
  expect(pseudo).toContain('lang="en-XA"');
});

test("pseudo-localizes every composite copy field without English fallbacks", () => {
  const english = uiCompositesCopyForLocale("en").copy;
  const pseudo = uiCompositesCopyForLocale("en-XA").copy;

  expect(Object.keys(pseudo).sort()).toEqual(Object.keys(english).sort());
  for (const [field, value] of Object.entries(pseudo)) {
    expect(value, field).not.toBe(english[field as keyof typeof english]);
    expect(value, field).toMatch(/^\[!! .+ !!\]$/u);
  }
});

test("marks internal English labels and never renders private message plaintext", () => {
  const markup = renderSpecimen("vi");

  expect(markup).toMatch(/<header(?=[^>]*lang="en")[^>]*>/u);
  expect(markup).toContain("Composite gallery");
  expect(markup).not.toContain("PRIVATE_FIXTURE_MESSAGE_SENTINEL");
  expect(markup).not.toContain("fullDisplayName");
});

test("supplies the interactive cart line with a quantity-adjusted subtotal", () => {
  const markup = renderSpecimen("en");
  const cartLine = markup.match(
    /<article[^>]*data-fs-composite="cart-line"[\s\S]*?<\/article>/u,
  )?.[0];

  expect(cartLine).toBeDefined();
  expect(cartLine).toContain('data-currency="USD"');
  expect(cartLine).toContain('value="25800"');
});

test("localizes every informative media alternative for all preview locales", () => {
  const expectations = {
    "en-XA": "[!! Fïçţïöñàļ pëřföřɱëř",
    es: "Artista ficticia Mira Vale junto a flores azules y marfil",
    ja: "青とアイボリーの花と並ぶ架空のアーティスト Mira Vale",
    pt: "Artista fictícia Mira Vale ao lado de flores azuis e marfim",
    th: "ศิลปินสมมติ Mira Vale กับดอกไม้สีน้ำเงินและงาช้าง",
    vi: "Nghệ sĩ hư cấu Mira Vale bên hoa xanh lam và trắng ngà",
    "zh-CN": "虚构艺人 Mira Vale 与蓝白色花朵同框",
  } as const;

  for (const [locale, heroAlt] of Object.entries(expectations)) {
    const markup = renderSpecimen(locale as keyof typeof expectations);
    expect(markup).toContain(`alt="${heroAlt}`);
    expect(markup).not.toContain(
      'alt="Fictional performer Mira Vale beside blue and ivory flowers"',
    );
  }
});
