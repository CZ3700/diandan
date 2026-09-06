import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewBody } from "./preview";
import { translator } from "./components";
it("renders plain-text fields as text and preserves only schema-validated biography markup", () => {
  const html = renderToStaticMarkup(
    <PreviewBody
      content={{
        kind: "IDOL",
        structure: {
          themeAccent: "#d8b26e",
          heroTextTone: "light",
          displayOrder: 0,
        },
        media: [],
        fields: {
          displayName: "<script>plain</script>",
          shortBio: "<img src=x onerror=alert(1)>",
          fullBio: "<p>A reviewed <strong>biography</strong>.</p>",
          seoTitle: "Title",
          seoDescription: "Description",
        },
      }}
      images={[]}
      t={translator("en")}
    />,
  );
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;img");
  expect(html).toContain("<strong>biography</strong>");
});
