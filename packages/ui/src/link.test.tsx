import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Link, type LinkProps } from "./link.js";

describe("Link", () => {
  test("renders a native link with expandable translated copy", () => {
    const copy =
      "Consulta todos los detalles de preparación y entrega de este regalo";
    const markup = renderToStaticMarkup(
      <Link href="/es/gifts/keepsake">{copy}</Link>,
    );

    expect(markup).toMatch(/^<a[^>]*href="\/es\/gifts\/keepsake"/u);
    expect(markup).toContain("fs-link--inline");
    expect(markup).toContain(copy);
  });

  test("adds reverse-tabnabbing and referrer protection to new tabs", () => {
    const markup = renderToStaticMarkup(
      <Link href="https://support.example" rel="nofollow" target="_blank">
        Support
      </Link>,
    );

    expect(markup).toContain('rel="nofollow noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
  });

  test("recognizes the case-insensitive HTML new-tab keyword", () => {
    const markup = renderToStaticMarkup(
      <Link href="/en/help" target="_BLANK">
        Help
      </Link>,
    );

    expect(markup).toContain('rel="noopener noreferrer"');
  });

  test("rejects a blank destination instead of creating a false link", () => {
    expect(() => renderToStaticMarkup(<Link href="   ">Help</Link>)).toThrow(
      /non-empty href/u,
    );
  });

  test("preserves native state and consumer classes", () => {
    const markup = renderToStaticMarkup(
      <Link
        aria-current="page"
        className="order-link"
        href="/en/orders/order_123"
        variant="standalone"
      >
        Current order
      </Link>,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("fs-link--standalone");
    expect(markup).toContain("order-link");
  });
});

// @ts-expect-error Links must remain navigable without JavaScript.
const missingDestination: LinkProps = { children: "Missing destination" };
void missingDestination;

const inlineStyleLink: LinkProps = {
  children: "Styled link",
  href: "/en",
  // @ts-expect-error Inline styles bypass the shared design-token boundary.
  style: { color: "red" },
};
void inlineStyleLink;
