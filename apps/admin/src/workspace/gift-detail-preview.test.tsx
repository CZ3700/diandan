import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { giftDetailDocumentSchema } from "@fan-support/contracts";
import { GiftDetailPreview } from "./gift-detail-preview";
it("renders structured details in document order with escaped text and matching item identities", () => {
  const html = renderToStaticMarkup(
    <GiftDetailPreview
      document={giftDetailDocumentSchema.parse({
        schemaVersion: 1,
        id: "30000000-0000-4000-8000-000000000001",
        giftRevisionId: "30000000-0000-4000-8000-000000000002",
        blocks: [
          { id: "heading", kind: "HEADING", level: 2 },
          { id: "specs", kind: "SPECIFICATIONS", itemIds: ["weight"] },
          {
            id: "steps",
            kind: "LIST",
            style: "ORDERED",
            itemIds: ["first", "second"],
          },
        ],
      })}
      translation={{
        blocks: [
          {
            blockId: "steps",
            kind: "LIST",
            items: [
              { itemId: "second", text: "Deliver" },
              { itemId: "first", text: "Prepare" },
            ],
          },
          {
            blockId: "heading",
            kind: "HEADING",
            text: "<script>Gift</script>",
          },
          {
            blockId: "specs",
            kind: "SPECIFICATIONS",
            items: [{ itemId: "weight", label: "Weight", value: "20 g" }],
          },
        ],
      }}
      renderMedia={() => null}
    />,
  );
  expect(html).toContain("<h2>&lt;script&gt;Gift&lt;/script&gt;</h2>");
  expect(html).toContain("<dt>Weight</dt><dd>20 g</dd>");
  expect(html).toContain("<ol><li>Prepare</li><li>Deliver</li></ol>");
});
