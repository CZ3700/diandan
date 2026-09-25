import { expect, test } from "vitest";

const DOCUMENT_ID = "0deaa693-7616-4938-9f34-149cd5c8c19d";
const GIFT_REVISION_ID = "1045cb31-735a-4c90-81bf-7af2b2dc8ee7";
const MEDIA_ID = "72b3b6db-813c-480f-b6c2-c273948b2035";
const METADATA_ID = "05b16e8c-d330-43f5-833a-c6766747f820";
const EDITOR_ID = "34d657b6-93b2-470f-a777-4ce1f98914e0";

function document() {
  return {
    schemaVersion: 1,
    id: DOCUMENT_ID,
    giftRevisionId: GIFT_REVISION_ID,
    blocks: [
      { id: "introduction", kind: "HEADING", level: 2 },
      { id: "story", kind: "PARAGRAPH" },
      { id: "contents", kind: "LIST", style: "UNORDERED", itemIds: ["rose"] },
      { id: "specs", kind: "SPECIFICATIONS", itemIds: ["size"] },
      {
        id: "photo",
        kind: "MEDIA",
        mediaAssetId: MEDIA_ID,
        mediaMetadataRevisionId: METADATA_ID,
        captionEnabled: true,
      },
    ],
  };
}

function fields() {
  return {
    blocks: [
      { blockId: "introduction", kind: "HEADING", text: "A thoughtful gift" },
      { blockId: "story", kind: "PARAGRAPH", text: "Prepared with care." },
      {
        blockId: "contents",
        kind: "LIST",
        items: [{ itemId: "rose", text: "One rose" }],
      },
      {
        blockId: "specs",
        kind: "SPECIFICATIONS",
        items: [{ itemId: "size", label: "Height", value: "30 cm" }],
      },
      {
        blockId: "photo",
        kind: "MEDIA",
        mediaMetadataRevisionId: METADATA_ID,
        caption: "Prepared bouquet",
      },
    ],
  };
}

function translation() {
  return {
    schemaVersion: 1,
    id: "9c0b2754-92ce-49c2-b909-27a0dd0af735",
    documentId: DOCUMENT_ID,
    giftRevisionId: GIFT_REVISION_ID,
    locale: "en",
    sourceHash: "a".repeat(64),
    translatedFromSourceHash: "a".repeat(64),
    origin: "HUMAN",
    editorId: EDITOR_ID,
    editedAt: "2026-09-05T01:00:00Z",
    review: { status: "DRAFT" },
    ...fields(),
  };
}

test("defines bounded structured gift details independently of the legacy description", async () => {
  const details = await import("./gift-details.js").catch(() => undefined);
  expect(details, "gift detail contract module must exist").toBeDefined();
  expect(details?.giftDetailDocumentSchema.safeParse(document()).success).toBe(
    true,
  );
  expect(
    details?.giftDetailTranslationSchema.safeParse(translation()).success,
  ).toBe(true);
  expect(
    details?.giftDetailDocumentSchema.safeParse({
      ...document(),
      schemaVersion: 2,
    }).success,
  ).toBe(false);
});

test("rejects duplicate structural and localized identities and arbitrary layout or URLs", async () => {
  const details = await import("./gift-details.js");
  const value = document();
  expect(
    details.giftDetailDocumentSchema.safeParse({
      ...value,
      blocks: [...value.blocks, value.blocks[0]],
    }).success,
  ).toBe(false);
  expect(
    details.giftDetailDocumentSchema.safeParse({
      ...value,
      blocks: [
        {
          id: "contents",
          kind: "LIST",
          style: "UNORDERED",
          itemIds: ["rose", "rose"],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    details.giftDetailDocumentSchema.safeParse({
      ...value,
      blocks: [
        { ...value.blocks[4], url: "https://example.invalid/untrusted.jpg" },
      ],
    }).success,
  ).toBe(false);
  expect(
    details.giftDetailDocumentSchema.safeParse({
      ...value,
      blocks: [{ ...value.blocks[0], style: "color:red" }],
    }).success,
  ).toBe(false);
  const copy = translation();
  expect(
    details.giftDetailTranslationSchema.safeParse({
      ...copy,
      blocks: [...copy.blocks, copy.blocks[0]],
    }).success,
  ).toBe(false);
  expect(
    details.giftDetailTranslationFieldsSchema.safeParse({
      blocks: [
        {
          blockId: "contents",
          kind: "LIST",
          items: [
            { itemId: "rose", text: "A" },
            { itemId: "rose", text: "B" },
          ],
        },
      ],
    }).success,
  ).toBe(false);
});

test("keeps detail text plain and bounded, including encoded markup", async () => {
  const details = await import("./gift-details.js");
  for (const text of [
    "<script>alert(1)</script>",
    "&lt;p&gt;Markup&lt;/p&gt;",
    " ",
    "x".repeat(4_001),
  ]) {
    expect(
      details.giftDetailTranslationFieldsSchema.safeParse({
        blocks: [{ blockId: "story", kind: "PARAGRAPH", text }],
      }).success,
    ).toBe(false);
  }
  expect(
    details.giftDetailDocumentSchema.safeParse({
      ...document(),
      blocks: Array.from({ length: 33 }, (_, index) => ({
        id: `block-${index}`,
        kind: "PARAGRAPH",
      })),
    }).success,
  ).toBe(false);
});

test("inherits the seven locale owner and existing source, review, and import invariants", async () => {
  const details = await import("./gift-details.js");
  const copy = translation();
  expect(
    details.giftDetailTranslationSchema.safeParse({ ...copy, locale: "en-XA" })
      .success,
  ).toBe(false);
  expect(
    details.giftDetailTranslationSchema.safeParse({
      ...copy,
      translatedFromSourceHash: "b".repeat(64),
    }).success,
  ).toBe(false);
  expect(
    details.giftDetailTranslationSchema.safeParse({ ...copy, origin: "IMPORT" })
      .success,
  ).toBe(false);
  expect(
    details.giftDetailTranslationSchema.safeParse({
      ...copy,
      review: {
        status: "APPROVED",
        reviewerId: EDITOR_ID,
        reviewedAt: "2026-09-05T02:00:00Z",
        reviewedSourceHash: copy.sourceHash,
        reviewedContentHash: copy.sourceHash,
      },
    }).success,
  ).toBe(false);
});
