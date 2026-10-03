import { describe, expect, test } from "vitest";
import {
  informationPageCommandSchema,
  informationPageFieldsSchema,
  informationPagePreviewMessageSchema,
  informationPageStructureSchema,
} from "./information-pages.js";
const id = "10000000-0000-4000-8000-000000000001";
const fields = {
  title: "About",
  summary: "",
  sections: [{ id, heading: "", body: "Real text" }],
};
describe("information pages bounded contracts", () => {
  test("accepts a bounded plain text document", () => {
    expect(informationPageFieldsSchema.parse(fields)).toEqual(fields);
  });
  test("rejects duplicated sections, extra markup fields and invisible body", () => {
    expect(
      informationPageFieldsSchema.safeParse({
        ...fields,
        sections: [...fields.sections, ...fields.sections],
      }).success,
    ).toBe(false);
    expect(
      informationPageFieldsSchema.safeParse({ ...fields, html: "<script>" })
        .success,
    ).toBe(false);
    expect(
      informationPageFieldsSchema.safeParse({
        ...fields,
        sections: [{ id, heading: "", body: "\u200b" }],
      }).success,
    ).toBe(false);
    expect(
      informationPageStructureSchema.safeParse({
        sectionIds: [id, id],
        contactEmail: null,
      }).success,
    ).toBe(false);
  });
  test("only English can author structure and FAQ questions are required", () => {
    const command = {
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      pageKey: "FAQ",
      locale: "en",
      expectedVersion: 0,
      idempotencyKey: "info-save-00000001",
      revisionId: null,
      expectedSourceHash: null,
      structure: { sectionIds: [id], contactEmail: null },
      fields,
    };
    expect(informationPageCommandSchema.safeParse(command).success).toBe(false);
    expect(
      informationPageCommandSchema.safeParse({
        ...command,
        fields: {
          ...fields,
          sections: [{ id, heading: "Question?", body: "Answer" }],
        },
      }).success,
    ).toBe(true);
    expect(
      informationPageCommandSchema.safeParse({
        ...command,
        pageKey: "ABOUT",
        locale: "ja",
      }).success,
    ).toBe(false);
    expect(
      informationPageCommandSchema.safeParse({
        ...command,
        pageKey: "ABOUT",
        structure: {
          sectionIds: [id],
          contactEmail: "support@example.invalid",
        },
      }).success,
    ).toBe(false);
  });
  test("preview is a strict selected-language document without actor/session fields", () => {
    const value = {
      schemaVersion: 1,
      type: "INFORMATION_PAGE_PREVIEW_RENDER",
      channel: id,
      document: {
        schemaVersion: 1,
        pageKey: "ABOUT",
        locale: "en",
        revisionId: id,
        sourceStatus: "CURRENT",
        structure: { sectionIds: [id], contactEmail: null },
        fields,
      },
    };
    expect(informationPagePreviewMessageSchema.safeParse(value).success).toBe(
      true,
    );
    expect(
      informationPagePreviewMessageSchema.safeParse({
        ...value,
        document: { ...value.document, actorId: id },
      }).success,
    ).toBe(false);
  });
});
test("plain information text is literal text, rejects database-unsafe controls and accepts visible punctuation", () => {
  for (const title of ["&nbsp;", "<>", "Visible\ntext"])
    expect(
      informationPageFieldsSchema.safeParse({ ...fields, title }).success,
    ).toBe(true);
  for (const title of ["a\u0000b", "a\u0001b", "\ud800", "\u200b"])
    expect(
      informationPageFieldsSchema.safeParse({ ...fields, title }).success,
    ).toBe(false);
});
