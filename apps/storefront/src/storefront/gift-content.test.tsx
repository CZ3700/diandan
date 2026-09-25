import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { GiftDescription, PolicyBody } from "./gift-content";

describe("published gift and policy rendering", () => {
  it("renders stable controlled text blocks with semantic lists and specifications", async () => {
    const html = renderToStaticMarkup(
      <GiftDescription
        copy={await loadStorefrontCopy("en")}
        details={{
          format: "BLOCKS",
          blocks: [
            { id: "intro", kind: "HEADING", level: 2, text: "A gift" },
            { id: "text", kind: "PARAGRAPH", text: "Care & thought" },
            {
              id: "list",
              kind: "LIST",
              style: "ORDERED",
              items: [{ id: "first", text: "Chosen with care" }],
            },
            {
              id: "spec",
              kind: "SPECIFICATIONS",
              items: [{ id: "material", label: "Material", value: "Cotton" }],
            },
          ],
        }}
      />,
    );
    expect(html).toContain("<h2>A gift</h2>");
    expect(html).toContain("Care &amp; thought");
    expect(html).toContain("<ol>");
    expect(html).toContain("<dt>Material</dt><dd>Cotton</dd>");
  });
  it("escapes legacy gift text and validates policy markup before injecting it", async () => {
    const copy = await loadStorefrontCopy("en");
    const html = renderToStaticMarkup(
      <GiftDescription
        copy={copy}
        details={{
          format: "LEGACY_TEXT",
          text: "<img src=x onerror=alert(1)>",
        }}
      />,
    );
    expect(html).not.toContain("<img");
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
