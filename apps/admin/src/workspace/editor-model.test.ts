import { describe, expect, it } from "vitest";
import {
  emptyFields,
  translationChanges,
  replaceAliasLocale,
  editableFields,
} from "./editor-model";
describe("revision form boundaries", () => {
  it("exposes new homepage labels as empty translations and removes obsolete slots", () => {
    const source = {
      kind: "HOMEPAGE" as const,
      fields: {
        heroTitle: "Source",
        heroSubtitle: "Source",
        ctaLabel: "Explore",
        slotLabels: [
          { slotKey: "kept", label: "Kept English" },
          { slotKey: "new", label: "New English" },
        ],
        seoTitle: "Title",
        seoDescription: "Description",
      },
    };
    const selected = {
      ...source.fields,
      slotLabels: [
        { slotKey: "kept", label: "已有译文" },
        { slotKey: "removed", label: "旧区块" },
      ],
    };
    expect(editableFields(source, selected)["slotLabels"]).toEqual([
      { slotKey: "kept", label: "已有译文" },
      { slotKey: "new", label: "" },
    ]);
    expect(editableFields(source)["heroTitle"]).toBe("");
  });
  it("does not fill a missing translation with the English source", () => {
    expect(
      emptyFields({
        kind: "IDOL",
        fields: {
          displayName: "Source",
          shortBio: "Source bio",
          fullBio: "Source text",
          seoTitle: "Title",
          seoDescription: "Description",
        },
      }),
    ).toEqual({
      displayName: "",
      shortBio: "",
      fullBio: "",
      seoTitle: "",
      seoDescription: "",
    });
  });
  it("submits only the selected language, with human draft provenance", () => {
    const fields = {
      displayName: "Name",
      shortBio: "Biography",
      fullBio: "Biography",
      seoTitle: "Name",
      seoDescription: "Description",
    };
    const changes = translationChanges("IDOL", "ja", fields);
    expect(changes).toMatchObject({
      kind: "IDOL",
      translations: [{ locale: "ja", origin: "HUMAN", fields }],
    });
    expect(() =>
      translationChanges("IDOL", "ja", {
        ...fields,
        displayName: "x".repeat(41),
      }),
    ).toThrow();
  });
  it("preserves aliases from other languages and stable ids of unchanged aliases", () => {
    const rows = [
      { id: "ja-one", locale: "ja" as const, text: "旧名" },
      { id: "universal", locale: null, text: "Universal" },
      { id: "en-one", locale: "en" as const, text: "Name" },
    ];
    const result = replaceAliasLocale(rows, "ja", "旧名\n新名");
    expect(result).toContainEqual(rows[0]);
    expect(result).toContainEqual(rows[1]);
    expect(result).toContainEqual(rows[2]);
    expect(result.filter((row) => row.locale === "ja")).toHaveLength(2);
  });
});
