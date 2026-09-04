import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Button, type ButtonProps } from "./button.js";

describe("Button", () => {
  test("uses safe native defaults and preserves expandable translated copy", () => {
    const copy =
      "[!! Continue with this intentionally expanded checkout action label !!]";
    const markup = renderToStaticMarkup(<Button>{copy}</Button>);

    expect(markup).toMatch(/^<button[^>]*type="button"/u);
    expect(markup).toContain("fs-button--primary");
    expect(markup).toContain("fs-button--standard");
    expect(markup).toContain(copy);
  });

  test("makes loading a disabled, named, size-stable native state", () => {
    const markup = renderToStaticMarkup(
      <Button loading variant="secondary">
        Place gift order
      </Button>,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-loading="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Place gift order");
  });

  test("preserves explicit button semantics and consumer classes", () => {
    const markup = renderToStaticMarkup(
      <Button className="checkout-submit" size="compact" type="submit">
        Confirm
      </Button>,
    );

    expect(markup).toMatch(/^<button[^>]*type="submit"/u);
    expect(markup).toContain("fs-button--compact");
    expect(markup).toContain("checkout-submit");
  });
});

const inlineStyleButton: ButtonProps = {
  children: "Unsafe",
  // @ts-expect-error Inline styles bypass the shared design-token boundary.
  style: { color: "red" },
};
void inlineStyleButton;
