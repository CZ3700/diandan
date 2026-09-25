import { expect, test } from "vitest";

const DOCUMENT_ID = "0deaa693-7616-4938-9f34-149cd5c8c19d";
const GIFT_REVISION_ID = "1045cb31-735a-4c90-81bf-7af2b2dc8ee7";
const MEDIA_ID = "72b3b6db-813c-480f-b6c2-c273948b2035";
const METADATA_ID = "05b16e8c-d330-43f5-833a-c6766747f820";

test("validates new detail fields against structure before revision IDs exist", async () => {
  const { validateGiftDetailFields } = await import("./gift-details.js");
  expect(validateGiftDetailFields(document().blocks, fields())).toEqual([]);
  expect(
    validateGiftDetailFields(document().blocks.slice(1), fields()),
  ).toContainEqual({
    code: "BLOCK_UNKNOWN",
    path: ["translation", "blocks", 0, "blockId"],
  });
  expect(validateGiftDetailFields(document().blocks, {})).toEqual([
    { code: "SCHEMA_INVALID", path: ["translation"] },
  ]);
});

function document() {
  return {
    schemaVersion: 1,
    id: DOCUMENT_ID,
    giftRevisionId: GIFT_REVISION_ID,
    blocks: [
      { id: "title", kind: "HEADING", level: 2 },
      { id: "story", kind: "PARAGRAPH" },
      {
        id: "contents",
        kind: "LIST",
        style: "UNORDERED",
        itemIds: ["rose", "card"],
      },
      { id: "specs", kind: "SPECIFICATIONS", itemIds: ["height"] },
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
      { blockId: "title", kind: "HEADING", text: "A thoughtful gift" },
      {
        blockId: "story",
        kind: "PARAGRAPH",
        text: "Prepared for a celebration.",
      },
      {
        blockId: "contents",
        kind: "LIST",
        items: [
          { itemId: "rose", text: "A rose" },
          { itemId: "card", text: "A card" },
        ],
      },
      {
        blockId: "specs",
        kind: "SPECIFICATIONS",
        items: [{ itemId: "height", label: "Height", value: "30 cm" }],
      },
      {
        blockId: "photo",
        kind: "MEDIA",
        mediaMetadataRevisionId: METADATA_ID,
        caption: "Café flowers",
      },
    ],
  };
}

async function validInput(locale = "en") {
  const details = await import("./gift-details.js");
  const value = document();
  const copy = fields();
  const sourceHash = details.computeGiftDetailTranslationContentHash(
    value,
    copy,
  );
  return {
    schemaVersion: 1,
    document: value,
    currentEnglishSourceHash: sourceHash,
    translation: {
      schemaVersion: 1,
      id: "9c0b2754-92ce-49c2-b909-27a0dd0af735",
      documentId: DOCUMENT_ID,
      giftRevisionId: GIFT_REVISION_ID,
      locale,
      sourceHash,
      translatedFromSourceHash: sourceHash,
      origin: "HUMAN",
      editorId: "34d657b6-93b2-470f-a777-4ce1f98914e0",
      editedAt: "2026-09-05T01:00:00Z",
      review: { status: "DRAFT" },
      ...copy,
    },
  };
}

test("validates detail structure and hashes without treating a valid draft as publication approval", async () => {
  const details = await import("./gift-details.js").catch(() => undefined);
  expect(details, "gift detail domain module must exist").toBeDefined();
  const input = await validInput();
  const before = structuredClone(input);
  expect(details?.validateGiftDetailTranslation(input)).toEqual({
    schemaVersion: 1,
    valid: true,
    contentHash: input.translation.sourceHash,
    issues: [],
  });
  expect(input).toEqual(before);
  expect(input.translation.review).toEqual({ status: "DRAFT" });
});

test("rejects mismatched document, revision, missing, unknown and wrongly typed blocks", async () => {
  const { validateGiftDetailTranslation } = await import("./gift-details.js");
  const input = await validInput();
  const cases = [
    {
      translation: { ...input.translation, documentId: MEDIA_ID },
      code: "DOCUMENT_TARGET_MISMATCH",
    },
    {
      translation: { ...input.translation, giftRevisionId: MEDIA_ID },
      code: "GIFT_REVISION_TARGET_MISMATCH",
    },
    {
      translation: {
        ...input.translation,
        blocks: input.translation.blocks.slice(1),
      },
      code: "BLOCK_MISSING",
    },
    {
      translation: {
        ...input.translation,
        blocks: [
          ...input.translation.blocks,
          { blockId: "unknown", kind: "PARAGRAPH", text: "Unknown" },
        ],
      },
      code: "BLOCK_UNKNOWN",
    },
    {
      translation: {
        ...input.translation,
        blocks: input.translation.blocks.map((block) =>
          block.blockId === "story" ? { ...block, kind: "HEADING" } : block,
        ),
      },
      code: "BLOCK_KIND_MISMATCH",
    },
  ];
  for (const value of cases) {
    expect(
      validateGiftDetailTranslation({
        ...input,
        translation: value.translation,
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: value.code }),
      ]),
    });
  }
});

test("rejects missing or extra list and specification items", async () => {
  const { validateGiftDetailTranslation } = await import("./gift-details.js");
  const input = await validInput();
  for (const [blockId, items, code] of [
    ["contents", [{ itemId: "rose", text: "A rose" }], "ITEM_MISSING"],
    [
      "contents",
      [
        { itemId: "rose", text: "A rose" },
        { itemId: "card", text: "A card" },
        { itemId: "extra", text: "Extra" },
      ],
      "ITEM_UNKNOWN",
    ],
    [
      "specs",
      [{ itemId: "width", label: "Width", value: "10 cm" }],
      "ITEM_UNKNOWN",
    ],
  ] as const) {
    const blocks = input.translation.blocks.map((block) =>
      block.blockId === blockId ? { ...block, items } : block,
    );
    expect(
      validateGiftDetailTranslation({
        ...input,
        translation: { ...input.translation, blocks },
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  }
});

test("binds media captions to the declared metadata revision and caption policy", async () => {
  const { validateGiftDetailTranslation } = await import("./gift-details.js");
  const input = await validInput();
  const replaced = input.translation.blocks.map((block) =>
    block.kind === "MEDIA"
      ? { ...block, mediaMetadataRevisionId: MEDIA_ID }
      : block,
  );
  expect(
    validateGiftDetailTranslation({
      ...input,
      translation: { ...input.translation, blocks: replaced },
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "MEDIA_REFERENCE_MISMATCH" }),
    ]),
  });
  const missing = input.translation.blocks.map((block) =>
    block.kind === "MEDIA"
      ? {
          blockId: block.blockId,
          kind: "MEDIA",
          mediaMetadataRevisionId: METADATA_ID,
        }
      : block,
  );
  expect(
    validateGiftDetailTranslation({
      ...input,
      translation: { ...input.translation, blocks: missing },
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "CAPTION_REQUIRED" }),
    ]),
  });
  const withoutCaption = {
    ...input.document,
    blocks: input.document.blocks.map((block) =>
      block.kind === "MEDIA" ? { ...block, captionEnabled: false } : block,
    ),
  };
  expect(
    validateGiftDetailTranslation({ ...input, document: withoutCaption }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "CAPTION_UNEXPECTED" }),
    ]),
  });
});

test("detects current English source changes and forged localized content hashes", async () => {
  const { validateGiftDetailTranslation } = await import("./gift-details.js");
  const input = await validInput("es");
  expect(
    validateGiftDetailTranslation({
      ...input,
      currentEnglishSourceHash: "b".repeat(64),
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "STALE_ENGLISH_SOURCE" }),
    ]),
  });
  expect(
    validateGiftDetailTranslation({
      ...input,
      translation: { ...input.translation, sourceHash: "b".repeat(64) },
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "CONTENT_HASH_MISMATCH" }),
    ]),
  });
  expect(
    validateGiftDetailTranslation({ ...input, schemaVersion: 2 }),
  ).toMatchObject({
    schemaVersion: 1,
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_INVALID" }),
    ]),
  });
});

test("rejects premature and stale approval audit claims and rechecks forged approved hashes", async () => {
  const { validateGiftDetailTranslation } = await import("./gift-details.js");
  const input = await validInput("es");
  const review = {
    status: "APPROVED",
    reviewerId: "c64367a8-350a-4fa5-b866-17ceeea511e0",
    reviewedAt: "2026-09-05T02:00:00Z",
    reviewedSourceHash: input.currentEnglishSourceHash,
    reviewedContentHash: input.translation.sourceHash,
  };
  for (const invalidReview of [
    { ...review, reviewedAt: "2026-09-05T00:00:00Z" },
    { ...review, reviewedSourceHash: "b".repeat(64) },
    { ...review, reviewedContentHash: "b".repeat(64) },
  ]) {
    expect(
      validateGiftDetailTranslation({
        ...input,
        translation: { ...input.translation, review: invalidReview },
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_INVALID" }),
      ]),
    });
  }
  expect(
    validateGiftDetailTranslation({
      ...input,
      translation: {
        ...input.translation,
        sourceHash: "b".repeat(64),
        review: { ...review, reviewedContentHash: "b".repeat(64) },
      },
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "CONTENT_HASH_MISMATCH" }),
    ]),
  });
  expect(
    validateGiftDetailTranslation({
      ...input,
      currentEnglishSourceHash: "b".repeat(64),
      translation: { ...input.translation, review },
    }),
  ).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "STALE_ENGLISH_SOURCE" }),
    ]),
  });
});

test("hashes semantic structure and NFC copy independently of revision identity and translation storage order", async () => {
  const { computeGiftDetailTranslationContentHash } =
    await import("./gift-details.js");
  const value = document();
  const copy = fields();
  const initial = computeGiftDetailTranslationContentHash(value, copy);
  expect(
    computeGiftDetailTranslationContentHash(
      { ...value, id: MEDIA_ID, giftRevisionId: MEDIA_ID },
      {
        blocks: copy.blocks.toReversed().map((block) =>
          block.kind === "LIST"
            ? { ...block, items: block.items?.toReversed() }
            : block.kind === "MEDIA"
              ? {
                  ...block,
                  caption: "Cafe\u0301 flowers",
                  mediaMetadataRevisionId: METADATA_ID.toUpperCase(),
                }
              : block,
        ),
      },
    ),
  ).toBe(initial);
  expect(
    computeGiftDetailTranslationContentHash(
      { ...value, blocks: value.blocks.toReversed() },
      copy,
    ),
  ).not.toBe(initial);
  expect(
    computeGiftDetailTranslationContentHash(
      {
        ...value,
        blocks: value.blocks.map((block) =>
          block.kind === "MEDIA"
            ? { ...block, mediaAssetId: DOCUMENT_ID }
            : block,
        ),
      },
      copy,
    ),
  ).not.toBe(initial);
  expect(() =>
    computeGiftDetailTranslationContentHash(value, {
      blocks: copy.blocks.slice(1),
    }),
  ).toThrow();
});
