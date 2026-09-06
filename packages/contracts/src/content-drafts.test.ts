import { describe, expect, it } from "vitest";

import {
  contentDraftReadCommandSchema,
  contentDraftResponseSchema,
  createGiftDetailDraftCommandSchema,
  createIdolAliasDraftCommandSchema,
  idolAliasSetSchema,
} from "./content-drafts.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const time = "2026-09-05T10:00:00Z";
const hash = "a".repeat(64);
const alias = { id: "stage-name", locale: null, text: "Luna" };
const authority = {
  actorId: id,
  reasonCode: "CONTENT_CREATED",
  requestId: otherId,
};
const aliasCommand = {
  schemaVersion: 1,
  id,
  idolRevisionId: otherId,
  aliases: [alias],
  ...authority,
};
const document = {
  schemaVersion: 1,
  id,
  giftRevisionId: otherId,
  blocks: [{ id: "intro", kind: "PARAGRAPH" }],
};
const translation = {
  id,
  locale: "en",
  origin: "HUMAN",
  blocks: [
    { blockId: "intro", kind: "PARAGRAPH", text: "A carefully prepared gift." },
  ],
};
const giftCommand = {
  schemaVersion: 1,
  document,
  translations: [translation],
  ...authority,
};
const aliasSet = {
  schemaVersion: 1,
  id,
  idolRevisionId: otherId,
  aliases: [alias],
  contentHash: hash,
  editorId: id,
  editedAt: time,
  review: { status: "DRAFT" },
};

describe("content draft commands", () => {
  it("accepts an empty alias set and requires no artificial English alias", () => {
    expect(
      createIdolAliasDraftCommandSchema.parse({ ...aliasCommand, aliases: [] })
        .aliases,
    ).toEqual([]);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [{ ...alias, locale: "th", text: "ลูน่า" }],
      }).success,
    ).toBe(true);
  });

  it("bounds alias count and stable identities", () => {
    const aliases = Array.from({ length: 64 }, (_, index) => ({
      ...alias,
      id: `alias-${index}`,
      text: `Name ${index}`,
    }));
    expect(
      createIdolAliasDraftCommandSchema.safeParse({ ...aliasCommand, aliases })
        .success,
    ).toBe(true);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [...aliases, { ...alias, id: "extra" }],
      }).success,
    ).toBe(false);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [alias, { ...alias, text: "Different" }],
      }).success,
    ).toBe(false);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [{ ...alias, id: "Bad ID" }],
      }).success,
    ).toBe(false);
  });

  it("rejects same-locale NFC duplicate copy while retaining transcription distinctions", () => {
    const first = { ...alias, text: "Café" };
    const second = { ...alias, id: "second", text: "Cafe\u0301" };
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [first, second],
      }).success,
    ).toBe(false);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [first, { ...second, locale: "en" }],
      }).success,
    ).toBe(true);
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [first, { ...second, text: "CAFÉ" }],
      }).success,
    ).toBe(true);
  });

  it.each([
    "",
    "  ",
    "\u200b",
    "<b>Luna</b>",
    "&lt;b&gt;Luna&lt;/b&gt;",
    "Luna\u0000",
    "a".repeat(81),
  ])("rejects non-plain or overlong alias text %j", (text) => {
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        aliases: [{ ...alias, text }],
      }).success,
    ).toBe(false);
  });

  it.each([
    { contentHash: hash },
    { editedAt: time },
    { review: { status: "APPROVED" } },
  ])("rejects caller-supplied alias evidence %j", (evidence) => {
    expect(
      createIdolAliasDraftCommandSchema.safeParse({
        ...aliasCommand,
        ...evidence,
      }).success,
    ).toBe(false);
  });

  it("requires UUID request identities and bounded audit reason codes", () => {
    for (const change of [
      { requestId: "request-one" },
      { reasonCode: "A" },
      { reasonCode: "lowercase" },
      { reasonCode: "A".repeat(129) },
    ]) {
      expect(
        createIdolAliasDraftCommandSchema.safeParse({
          ...aliasCommand,
          ...change,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts a partial detail draft with a real English row", () => {
    expect(
      createGiftDetailDraftCommandSchema.safeParse(giftCommand).success,
    ).toBe(true);
    expect(
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [],
      }).success,
    ).toBe(false);
    expect(
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [{ ...translation, locale: "ja" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate locales and case-insensitive duplicate translation IDs", () => {
    expect(
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [translation, { ...translation, id: otherId }],
      }).success,
    ).toBe(false);
    expect(
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [
          translation,
          { ...translation, id: id.toUpperCase(), locale: "ja" },
        ],
      }).success,
    ).toBe(false);
  });

  it("retains import provenance only for imported copy", () => {
    const test = (origin: string, importBatchId?: string) =>
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [
          {
            ...translation,
            origin,
            ...(importBatchId ? { importBatchId } : {}),
          },
        ],
      }).success;
    expect(test("IMPORT", otherId)).toBe(true);
    expect(test("IMPORT")).toBe(false);
    expect(test("HUMAN", otherId)).toBe(false);
    expect(test("MACHINE")).toBe(true);
  });

  it.each([
    { sourceHash: hash },
    { translatedFromSourceHash: hash },
    { editedAt: time },
    { editorId: otherId },
    { review: { status: "DRAFT" } },
  ])("rejects supplied detail audit fields %j", (audit) => {
    expect(
      createGiftDetailDraftCommandSchema.safeParse({
        ...giftCommand,
        translations: [{ ...translation, ...audit }],
      }).success,
    ).toBe(false);
  });

  it("allows only the matching read target identity", () => {
    expect(
      contentDraftReadCommandSchema.safeParse({
        schemaVersion: 1,
        kind: "IDOL_ALIASES",
        idolRevisionId: id,
      }).success,
    ).toBe(true);
    expect(
      contentDraftReadCommandSchema.safeParse({
        schemaVersion: 1,
        kind: "GIFT_DETAILS",
        giftRevisionId: id,
      }).success,
    ).toBe(true);
    expect(
      contentDraftReadCommandSchema.safeParse({
        schemaVersion: 1,
        kind: "GIFT_DETAILS",
        idolRevisionId: id,
      }).success,
    ).toBe(false);
  });
});

describe("independent alias review evidence", () => {
  const approved = {
    status: "APPROVED",
    reviewerId: otherId,
    reviewedAt: time,
    reviewedContentHash: hash,
  };

  it("binds approval to the set hash and an independent reviewer", () => {
    expect(
      idolAliasSetSchema.safeParse({ ...aliasSet, review: approved }).success,
    ).toBe(true);
    for (const review of [
      { ...approved, reviewerId: id.toUpperCase() },
      { ...approved, reviewedContentHash: "b".repeat(64) },
      { ...approved, reviewedAt: "2026-09-04T10:00:00Z" },
      { status: "IN_REVIEW", submittedAt: "2026-09-04T10:00:00Z" },
    ]) {
      expect(
        idolAliasSetSchema.safeParse({ ...aliasSet, review }).success,
      ).toBe(false);
    }
  });

  it("does not accept English source evidence on aliases", () => {
    expect(
      idolAliasSetSchema.safeParse({
        ...aliasSet,
        review: { ...approved, reviewedSourceHash: hash },
      }).success,
    ).toBe(false);
  });

  it("shares a strict failure and read response union", () => {
    expect(
      contentDraftResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        aliasSet,
      }).success,
    ).toBe(true);
    expect(
      contentDraftResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "NOT_FOUND",
      }).success,
    ).toBe(true);
    expect(
      contentDraftResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "NOT_FOUND",
        error: "raw database error",
      }).success,
    ).toBe(false);
  });
});
