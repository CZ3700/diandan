import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PolicyBody } from "./gift-content";

describe("published policy rendering", () => {
  it("validates policy markup before injecting it", () => {
    expect(() =>
      renderToStaticMarkup(
        <PolicyBody body={'<p onclick="alert(1)">Unsafe</p>'} />,
      ),
    ).toThrow();
    expect(
      renderToStaticMarkup(
        <PolicyBody body="<p>Read <strong>carefully</strong>.</p>" />,
      ),
    ).toContain("<strong>carefully</strong>");
  });
});
