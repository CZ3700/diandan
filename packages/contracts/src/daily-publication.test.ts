import { expect, test } from "vitest";
import { dailyPublicationDocumentSchema } from "./daily-publication.js";

const id = "10000000-0000-4000-8000-000000000001";
const source = {
  id,
  locale: "zh-CN",
  sourceHash: "a".repeat(64),
  editorId: id,
  editedAt: "2026-09-08T00:00:00.000000Z",
  fields: {
    displayName: "星野",
    shortBio: "简介",
    fullBio: "真实原文",
    seoTitle: "星野",
    seoDescription: "简介",
  },
};
const document = {
  schemaVersion: 3,
  kind: "IDOL",
  ownerId: id,
  revisionId: id,
  revisionNumber: 1,
  createdBy: id,
  createdAt: source.editedAt,
  source,
  structure: { themeAccent: "#b79b67", heroTextTone: "light", displayOrder: 0 },
  media: [],
};
test("daily source documents have one genuine source, without an English row or approval fiction", () => {
  expect(dailyPublicationDocumentSchema.parse(document)).toEqual(document);
  expect(
    dailyPublicationDocumentSchema.safeParse({
      ...document,
      translations: [{ ...source, locale: "en" }],
    }).success,
  ).toBe(false);
  expect(
    dailyPublicationDocumentSchema.safeParse({
      ...document,
      source: { ...source, reviewStatus: "APPROVED" },
    }).success,
  ).toBe(false);
});
test("daily publication never admits policies or payment configuration", () => {
  for (const kind of ["POLICY", "PAYMENT_ROUTING", "SITE_LOCALE_CONFIG"])
    expect(
      dailyPublicationDocumentSchema.safeParse({ ...document, kind }).success,
    ).toBe(false);
});

test("daily artist originals preserve literal punctuation as plain text", () => {
  const input = {
    ...document,
    source: {
      ...source,
      fields: { ...source.fields, fullBio: "感谢支持 <3，期待再见。" },
    },
  };
  expect(dailyPublicationDocumentSchema.parse(input)).toEqual(input);
});
