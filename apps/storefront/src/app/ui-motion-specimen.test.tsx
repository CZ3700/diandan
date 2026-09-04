import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { UiMotionSpecimen } from "./ui-motion-specimen.js";
import { uiMotionCopyForLocale } from "./ui-motion-copy.js";

type MotionLocale = Parameters<typeof UiMotionSpecimen>[0]["locale"];

function render(locale: MotionLocale): string {
  return renderToStaticMarkup(<UiMotionSpecimen locale={locale} />);
}

describe("UI motion specimen", () => {
  test("renders the four reviewed motion surfaces as an internal fixture", () => {
    const markup = render("en");

    expect(markup).toContain('data-ui-motion="v1"');
    expect(markup).toContain('data-motion-fixture="true"');
    for (const surface of [
      "hero-entrance",
      "idol-switcher",
      "add-to-cart",
      "success-reveal",
    ]) {
      expect(markup).toContain(`data-fs-motion="${surface}"`);
    }
    expect(markup).toContain('data-order-status="confirmed"');
    expect(markup).toContain('name="');
    expect(markup).toContain('type="radio"');
  });

  test("uses local fictional media and never presents the fixture as payment proof", () => {
    const markup = render("en");

    expect(markup).toContain(
      "/ui-composites/fictional-performer-hero-mobile.png",
    );
    expect(markup).toContain("Noa Aster");
    expect(markup).not.toMatch(/(?:src|srcset)="https?:/iu);
    expect(markup).toContain("Internal interaction fixture");
    expect(markup).not.toContain("payment succeeded");
    expect(markup).not.toContain("PRIVATE_FIXTURE_MESSAGE_SENTINEL");
  });

  test.each(["en", "en-XA", "es", "ja", "pt", "th", "vi", "zh-CN"] as const)(
    "renders complete %s copy without blank controls",
    (locale) => {
      const markup = render(locale);

      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).not.toMatch(/<(?:button|legend|h1|h2|h3)[^>]*>\s*<\//u);
      expect(markup).not.toContain("undefined");
    },
  );

  test("expands every pseudo-localized copy leaf", () => {
    const english = uiMotionCopyForLocale("en").copy;
    const pseudo = uiMotionCopyForLocale("en-XA").copy;

    expect(Object.keys(pseudo).sort()).toEqual(Object.keys(english).sort());
    for (const [field, value] of Object.entries(pseudo)) {
      expect(value, field).not.toBe(english[field as keyof typeof english]);
      expect(value, field).toMatch(/^\[!! .+ !!\]$/u);
    }
  });
});
