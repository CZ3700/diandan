import { describe, expect, it } from "vitest";
import {
  giftDetailTranslationFieldsSchema,
  giftVariantIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
} from "@fan-support/contracts";
import {
  alignDetailBlocks,
  newGiftContent,
  parseAmountMinor,
  replaceDetailTranslation,
  orderGiftMedia,
} from "./gift-editor-model";

describe("gift editing boundaries", () => {
  it("keeps gallery order unique after deleting a middle image and adding another", () => {
    const media = [0, 1, 2].map((sortOrder) => ({
      mediaAssetId: mediaAssetIdSchema.parse(
        `20000000-0000-4000-8000-00000000000${sortOrder + 1}`,
      ),
      mediaMetadataRevisionId: mediaMetadataRevisionIdSchema.parse(
        `30000000-0000-4000-8000-00000000000${sortOrder + 1}`,
      ),
      role: "GALLERY" as const,
      sortOrder,
    }));
    const removed = orderGiftMedia(media.filter((_, i) => i !== 1));
    const added = orderGiftMedia([...removed, media[1]!]);
    expect(added.map((m) => m.mediaAssetId)).toEqual([
      media[0]!.mediaAssetId,
      media[2]!.mediaAssetId,
      media[1]!.mediaAssetId,
    ]);
    expect(added.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
  });
  it("requires fresh translations after English detail edits rather than rebinding old copy", () => {
    const details = {
      blocks: [{ id: "intro", kind: "PARAGRAPH" as const }],
      translations: [
        {
          locale: "en" as const,
          origin: "HUMAN" as const,
          blocks: [
            {
              blockId: "intro",
              kind: "PARAGRAPH" as const,
              text: "Old source",
            },
          ],
        },
        {
          locale: "ja" as const,
          origin: "HUMAN" as const,
          blocks: [
            { blockId: "intro", kind: "PARAGRAPH" as const, text: "旧訳" },
          ],
        },
      ],
    };
    const result = replaceDetailTranslation(details, "en", [
      { blockId: "intro", kind: "PARAGRAPH", text: "New source" },
    ]);
    expect(result.translations).toHaveLength(1);
    expect(result.translations[0]?.locale).toBe("en");
    expect(
      replaceDetailTranslation(details, "ja", [
        { blockId: "intro", kind: "PARAGRAPH", text: "新訳" },
      ]).translations[0],
    ).toEqual(details.translations[0]);
  });
  it("starts with real variants and studio fulfillment, without invented content", () => {
    const id = giftVariantIdSchema.parse(
      "20000000-0000-4000-8000-000000000001",
    );
    const content = newGiftContent([{ id }]);
    expect(content.structure.shippingMode).toBe("internal_to_idol");
    expect(content.translations[0]?.fields.variantLabels).toEqual([
      { giftVariantId: id, label: "" },
    ]);
    expect(content.translations[0]?.fields.fulfillmentDescription).toBe("");
  });
  it("aligns detail translations by stable block and item identity", () => {
    const result = alignDetailBlocks(
      [
        { id: "heading", kind: "HEADING", level: 2 },
        {
          id: "list",
          kind: "LIST",
          style: "UNORDERED",
          itemIds: ["second", "new"],
        },
      ],
      [
        { blockId: "heading", kind: "HEADING", text: "标题" },
        {
          blockId: "list",
          kind: "LIST",
          items: [
            { itemId: "first", text: "旧" },
            { itemId: "second", text: "保留" },
          ],
        },
      ],
    );
    expect(result).toEqual([
      { blockId: "heading", kind: "HEADING", text: "标题" },
      {
        blockId: "list",
        kind: "LIST",
        items: [
          { itemId: "second", text: "保留" },
          { itemId: "new", text: "" },
        ],
      },
    ]);
    expect(
      giftDetailTranslationFieldsSchema.safeParse({ blocks: result }).success,
    ).toBe(false);
  });
  it("parses currency amounts exactly and rejects ambiguous or rounded input", () => {
    expect(parseAmountMinor("10.29", "USD")).toBe(1029);
    expect(parseAmountMinor("29", "JPY")).toBe(29);
    expect(parseAmountMinor("1.123", "KWD")).toBe(1123);
    for (const value of [
      "1.001",
      "1e3",
      "-1",
      "1,000",
      "Infinity",
      "900719925474099.99",
    ])
      expect(() => parseAmountMinor(value, "USD")).toThrow();
    expect(() => parseAmountMinor("1.5", "JPY")).toThrow();
  });
});
