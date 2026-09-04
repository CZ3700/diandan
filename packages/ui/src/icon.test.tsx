import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Icon, type IconProps } from "./icon.js";

describe("Icon", () => {
  test("gives informative artwork an accessible name without making it focusable", () => {
    const markup = renderToStaticMarkup(
      <Icon label="Order complete" name="check" />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Order complete"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toContain("aria-hidden");
    expect(markup).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test("hides decorative artwork from assistive technology", () => {
    const markup = renderToStaticMarkup(
      <Icon className="quantity-icon" decorative name="minus" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("aria-label");
    expect(markup).toContain("fs-icon");
    expect(markup).toContain("quantity-icon");
  });

  test("rejects an empty accessible name for informative artwork", () => {
    expect(() =>
      renderToStaticMarkup(<Icon label="   " name="warning" />),
    ).toThrow(/non-empty label/u);
  });

  test("renders each owned glyph from the same SVG system", () => {
    for (const name of [
      "arrow-left",
      "arrow-right",
      "check",
      "chevron-down",
      "close",
      "minus",
      "plus",
      "shopping-bag",
      "warning",
    ] as const) {
      const markup = renderToStaticMarkup(<Icon decorative name={name} />);

      expect(markup).toMatch(/^<svg/u);
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toMatch(/<(?:path|circle|line|polyline)\b/u);
    }
  });
});

// @ts-expect-error Informative icons require a localized accessible name.
const unnamedIcon: IconProps = { name: "warning" };
void unnamedIcon;

// @ts-expect-error Decorative icons cannot expose a contradictory label.
const contradictoryIcon: IconProps = {
  decorative: true,
  label: "Hidden warning",
  name: "warning",
};
void contradictoryIcon;

const unknownIcon: IconProps = {
  decorative: true,
  // @ts-expect-error The icon library is a closed, source-owned set.
  name: "emoji-heart",
};
void unknownIcon;
