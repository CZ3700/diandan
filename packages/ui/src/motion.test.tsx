import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import * as motion from "./motion.js";

describe("motion server entry", () => {
  test("exports only the two server-compatible presence wrappers", () => {
    expect(Object.keys(motion).sort()).toEqual([
      "HeroEntrance",
      "SuccessReveal",
    ]);
  });

  test("adds a non-interactive hero entrance boundary without changing its semantics", () => {
    const markup = renderToStaticMarkup(
      <motion.HeroEntrance>
        <section aria-labelledby="hero-title">
          <h1 id="hero-title">A thoughtful gift</h1>
        </section>
      </motion.HeroEntrance>,
    );

    expect(markup).toContain('data-fs-motion="hero-entrance"');
    expect(markup).toContain('data-motion-token="--motion-hero-effective"');
    expect(markup).toContain('<section aria-labelledby="hero-title">');
    expect(markup).not.toContain("tabindex");
  });

  test("renders a static, semantic success endpoint with a decorative marker", () => {
    const markup = renderToStaticMarkup(
      <motion.SuccessReveal
        description="Your order details are ready."
        status="confirmed"
        title="Gift order confirmed"
      >
        <p>Order FS-1024</p>
      </motion.SuccessReveal>,
    );

    expect(markup).toContain('data-fs-motion="success-reveal"');
    expect(markup).toContain('data-order-status="confirmed"');
    expect(markup).toContain('data-motion-token="--motion-hero-effective"');
    expect(markup).toContain("Gift order confirmed");
    expect(markup).toContain("Your order details are ready.");
    expect(markup).toContain("Order FS-1024");
    expect(markup).toMatch(/<svg[^>]+aria-hidden="true"/u);
    expect(markup).not.toContain('role="alert"');
  });

  test("rejects blank success copy", () => {
    expect(() =>
      renderToStaticMarkup(
        <motion.SuccessReveal status="confirmed" title=" " />,
      ),
    ).toThrow(/title/u);
    expect(() =>
      renderToStaticMarkup(
        <motion.SuccessReveal
          description=" "
          status="confirmed"
          title="Confirmed"
        />,
      ),
    ).toThrow(/description/u);
  });
});
