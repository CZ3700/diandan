import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewBody } from "./preview";
import { translator } from "./components";
import {
  giftDetailDocumentSchema,
  giftVariantIdSchema,
} from "@fan-support/contracts";
it("shows gift detail blocks and variant labels in the actual preview", () => {
  const html = renderToStaticMarkup(
    <PreviewBody
      content={{
        kind: "GIFT",
        media: [],
        structure: {
          category: "OTHER",
          contents: [{ componentCode: "ITEM", quantity: 1, unit: "ITEM" }],
          deliveryEstimate: { minimum: 1, maximum: 7, unit: "DAY" },
          requiresSafetyNotice: false,
          shippingMode: "internal_to_idol",
        },
        fields: {
          title: "Gift",
          shortDescription: "Short",
          description: "Description",
          fulfillmentDescription: "Studio preparation",
          seoTitle: "Gift",
          seoDescription: "Description",
          variantLabels: [
            {
              giftVariantId: giftVariantIdSchema.parse(
                "40000000-0000-4000-8000-000000000001",
              ),
              label: "Studio edition",
            },
          ],
        },
        details: {
          document: giftDetailDocumentSchema.parse({
            schemaVersion: 1,
            id: "40000000-0000-4000-8000-000000000002",
            giftRevisionId: "40000000-0000-4000-8000-000000000003",
            blocks: [{ id: "preparation", kind: "HEADING", level: 2 }],
          }),
          translation: {
            blocks: [
              {
                blockId: "preparation",
                kind: "HEADING",
                text: "Gift detail heading",
              },
            ],
          },
        },
      }}
      images={[]}
      t={translator("en")}
    />,
  );
  expect(html).toContain("Studio edition");
  expect(html).toContain("<h2>Gift detail heading</h2>");
});
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
