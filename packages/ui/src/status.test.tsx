import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Status, type StatusProps } from "./status.js";

describe("Status", () => {
  test("renders visible status text without announcing static content", () => {
    const copy = "Preparando cuidadosamente tu regalo para la entrega";
    const markup = renderToStaticMarkup(<Status>{copy}</Status>);

    expect(markup).toMatch(/^<span\b/u);
    expect(markup).toContain("fs-status--neutral");
    expect(markup).toContain(copy);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain("aria-live");
  });

  test("exposes semantic tones without replacing visible localized text", () => {
    const markup = renderToStaticMarkup(
      <Status className="fulfillment-state" tone="warning">
        Delivery paused
      </Status>,
    );

    expect(markup).toContain("fs-status--warning");
    expect(markup).toContain("fulfillment-state");
    expect(markup).toContain("Delivery paused");
  });

  test("lets the caller opt into a live region for genuinely dynamic updates", () => {
    const markup = renderToStaticMarkup(
      <Status aria-live="polite" role="status" tone="success">
        Payment confirmed
      </Status>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });
});

const inlineStyleStatus: StatusProps = {
  children: "Ready",
  // @ts-expect-error Inline styles bypass the shared design-token boundary.
  style: { color: "green" },
};
void inlineStyleStatus;
