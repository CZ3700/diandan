import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

import {
  computeIdolAliasContentHash,
  prepareGiftDetailDraft,
  prepareIdolAliasDraft,
} from "./content-drafts.js";
import {
  computeGiftDetailTranslationContentHash,
  validateGiftDetailTranslation,
} from "./gift-details.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const time = "2026-09-05T10:00:00Z";
const authority = {
  actorId: id,
  reasonCode: "CONTENT_CREATED",
  requestId: otherId,
};
const aliasCommand = {
  schemaVersion: 1,
  id,
  idolRevisionId: otherId,
  aliases: [{ id: "stage-name", locale: null, text: "Café" }],
  ...authority,
};
const document = {
  schemaVersion: 1,
  id,
  giftRevisionId: otherId,
  blocks: [
    { id: "intro", kind: "PARAGRAPH" },
    {
      id: "contents",
      kind: "LIST",
      style: "UNORDERED",
      itemIds: ["card", "gift"],
    },
  ],
};
const fields = {
  blocks: [
    { blockId: "intro", kind: "PARAGRAPH", text: "A gift." },
    {
      blockId: "contents",
      kind: "LIST",
      items: [
        { itemId: "card", text: "Card" },
        { itemId: "gift", text: "Gift" },
      ],
    },
  ],
};
const translation = { id, locale: "en", origin: "HUMAN", ...fields };
const giftCommand = {
  schemaVersion: 1,
  document,
  translations: [
    translation,
    {
      ...translation,
      id: otherId,
      locale: "ja",
      origin: "MACHINE",
      blocks: [
        { blockId: "intro", kind: "PARAGRAPH", text: "贈り物です。" },
        fields.blocks[1],
      ],
    },
  ],
  ...authority,
};

describe("prepareIdolAliasDraft", () => {
  it("creates a server-hashed independent draft without mutating the command", () => {
    const before = structuredClone(aliasCommand);
    const result = prepareIdolAliasDraft(aliasCommand, time);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.aliasSet).toEqual({
      schemaVersion: 1,
      id,
      idolRevisionId: otherId,
      aliases: aliasCommand.aliases,
      editorId: id,
      editedAt: time,
      contentHash: computeIdolAliasContentHash(aliasCommand.aliases),
      review: { status: "DRAFT" },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(aliasCommand).toEqual(before);
  });

  it("hashes an empty set and canonicalizes NFC and nonsemantic entry order", () => {
    expect(computeIdolAliasContentHash([])).toMatch(/^[a-f0-9]{64}$/u);
    const first = aliasCommand.aliases[0]!;
    const second = { id: "other", locale: "ja", text: "ルナ" };
    expect(computeIdolAliasContentHash([first, second])).toBe(
      computeIdolAliasContentHash([second, { ...first, text: "Cafe\u0301" }]),
    );
    for (const change of [
      { id: "new-name" },
      { locale: "en" },
      { text: "CAFÉ" },
    ]) {
      expect(computeIdolAliasContentHash([{ ...first, ...change }])).not.toBe(
        computeIdolAliasContentHash([first]),
      );
    }
  });

  it("rejects forged evidence and fails closed for an invalid server clock", () => {
    expect(
      prepareIdolAliasDraft(
        { ...aliasCommand, contentHash: "a".repeat(64) },
        time,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(prepareIdolAliasDraft(aliasCommand, "bad-time")).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  });
});

describe("prepareGiftDetailDraft", () => {
  it("recomputes every hash from real copy and binds all drafts to actual English", () => {
    const before = structuredClone(giftCommand);
    const result = prepareGiftDetailDraft(giftCommand, time);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const englishHash = computeGiftDetailTranslationContentHash(
      document,
      fields,
    );
    for (const row of result.translations) {
      expect(row.editorId).toBe(id);
      expect(row.editedAt).toBe(time);
      expect(row.review).toEqual({ status: "DRAFT" });
      expect(row.translatedFromSourceHash).toBe(englishHash);
      expect(
        validateGiftDetailTranslation({
          schemaVersion: 1,
          document: result.document,
          translation: row,
          currentEnglishSourceHash: englishHash,
        }).valid,
      ).toBe(true);
    }
    expect(result.translations[1]?.sourceHash).not.toBe(englishHash);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(giftCommand).toEqual(before);
  });

  it("supports all seven locales, imported provenance, and keeps every review DRAFT", () => {
    const result = prepareGiftDetailDraft(
      {
        ...giftCommand,
        translations: SUPPORTED_LOCALES.map((locale, index) => ({
          ...translation,
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
          locale,
          origin: "IMPORT",
          importBatchId: otherId,
        })),
      },
      time,
    );
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.translations).toHaveLength(7);
    expect(
      result.translations.every(
        (row) => row.importBatchId === otherId && row.review.status === "DRAFT",
      ),
    ).toBe(true);
  });

  it("finds English irrespective of row order and makes semantic structure changes stale", () => {
    const reordered = prepareGiftDetailDraft(
      { ...giftCommand, translations: [...giftCommand.translations].reverse() },
      time,
    );
    const changed = prepareGiftDetailDraft(
      {
        ...giftCommand,
        document: { ...document, blocks: [...document.blocks].reverse() },
      },
      time,
    );
    expect(reordered.outcome).toBe("SUCCESS");
    expect(changed.outcome).toBe("SUCCESS");
    if (reordered.outcome !== "SUCCESS" || changed.outcome !== "SUCCESS")
      throw new Error("expected success");
    const oldHash = computeGiftDetailTranslationContentHash(document, fields);
    expect(
      reordered.translations.every(
        (row) => row.translatedFromSourceHash === oldHash,
      ),
    ).toBe(true);
    expect(
      changed.translations.every(
        (row) => row.translatedFromSourceHash !== oldHash,
      ),
    ).toBe(true);
  });

  it.each(
    [
      [{ blockId: "intro", kind: "PARAGRAPH", text: "Missing list" }],
      [
        ...fields.blocks,
        { blockId: "unknown", kind: "PARAGRAPH", text: "Unknown" },
      ],
      [
        { blockId: "intro", kind: "HEADING", text: "Wrong kind" },
        fields.blocks[1],
      ],
      [
        fields.blocks[0],
        {
          blockId: "contents",
          kind: "LIST",
          items: [{ itemId: "card", text: "Missing gift" }],
        },
      ],
      [
        fields.blocks[0],
        {
          blockId: "contents",
          kind: "LIST",
          items: [
            { itemId: "card", text: "Card" },
            { itemId: "unknown", text: "Unknown" },
          ],
        },
      ],
    ].map((blocks) => ({ blocks })),
  )(
    "rejects well-formed copy with mismatched block or item structure %#",
    ({ blocks }) => {
      expect(
        prepareGiftDetailDraft(
          { ...giftCommand, translations: [{ ...translation, blocks }] },
          time,
        ),
      ).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_CONTENT",
      });
    },
  );

  it("omits absent optional properties from its strict JSON snapshot", () => {
    const result = prepareGiftDetailDraft(
      {
        ...giftCommand,
        document: {
          ...document,
          blocks: [
            {
              id: "photo",
              kind: "MEDIA",
              mediaAssetId: id,
              mediaMetadataRevisionId: otherId,
              captionEnabled: false,
            },
          ],
        },
        translations: [
          {
            ...translation,
            importBatchId: undefined,
            blocks: [
              {
                blockId: "photo",
                kind: "MEDIA",
                mediaMetadataRevisionId: otherId,
                caption: undefined,
              },
            ],
          },
        ],
      },
      time,
    );
    expect(result.outcome).toBe("SUCCESS");
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it("rejects mismatched media references and caption flags", () => {
    const mediaDocument = {
      ...document,
      blocks: [
        {
          id: "photo",
          kind: "MEDIA",
          mediaAssetId: id,
          mediaMetadataRevisionId: otherId,
          captionEnabled: true,
        },
      ],
    };
    for (const block of [
      {
        blockId: "photo",
        kind: "MEDIA",
        mediaMetadataRevisionId: id,
        caption: "Photo",
      },
      { blockId: "photo", kind: "MEDIA", mediaMetadataRevisionId: otherId },
    ]) {
      expect(
        prepareGiftDetailDraft(
          {
            ...giftCommand,
            document: mediaDocument,
            translations: [{ ...translation, blocks: [block] }],
          },
          time,
        ),
      ).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_CONTENT",
      });
    }
    expect(
      prepareGiftDetailDraft(
        {
          ...giftCommand,
          document: {
            ...mediaDocument,
            blocks: [{ ...mediaDocument.blocks[0], captionEnabled: false }],
          },
          translations: [
            {
              ...translation,
              blocks: [
                {
                  blockId: "photo",
                  kind: "MEDIA",
                  mediaMetadataRevisionId: otherId,
                  caption: "Unexpected",
                },
              ],
            },
          ],
        },
        time,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_CONTENT",
    });
  });

  it("rejects invalid input without leaking raw validation errors", () => {
    expect(
      prepareGiftDetailDraft(
        {
          ...giftCommand,
          translations: [{ ...translation, sourceHash: "forged" }],
        },
        time,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "INVALID_COMMAND",
    });
    expect(prepareGiftDetailDraft(giftCommand, "bad-time")).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  });
});
