import { describe, expect, it } from "vitest";
import { giftVariantIdSchema } from "@fan-support/contracts";
import {
  emptyFields,
  translationChanges,
  replaceAliasLocale,
  editableFields,
  reconcileVariantLabels,
  savedRevisionId,
} from "./editor-model";
describe("revision form boundaries", () => {
  it("exposes newly created draft variants for English naming before activation", () => {
    expect(
      reconcileVariantLabels(
        { variantLabels: [{ giftVariantId: "old", label: "Keep" }] },
        [{ id: "new" }, { id: "old" }],
      ),
    ).toEqual({
      variantLabels: [
        { giftVariantId: "new", label: "" },
        { giftVariantId: "old", label: "Keep" },
      ],
    });
  });
  it("opens the new gift revision rather than the commerce receipt after save", () => {
    const revision = "50000000-0000-4000-8000-000000000001";
    const receipt = "50000000-0000-4000-8000-000000000002";
    expect(
      savedRevisionId({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "SAVE_GIFT_CONTENT",
        resultId: receipt,
        replayed: false,
        giftId: receipt,
        giftRevisionId: revision,
        authoringVersion: 1,
        profileHash: "a".repeat(64),
      }),
    ).toBe(revision);
    expect(
      savedRevisionId({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: revision,
        replayed: false,
      }),
    ).toBe(revision);
    expect(() =>
      savedRevisionId({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "CREATE_GIFT",
        resultId: receipt,
        replayed: false,
        giftId: receipt,
        baseVersion: 1,
      }),
    ).toThrow();
  });
  it("keeps gift variant identities while reconciling missing translations", () => {
    const first = giftVariantIdSchema.parse(
      "10000000-0000-4000-8000-000000000001",
    );
    const second = giftVariantIdSchema.parse(
      "10000000-0000-4000-8000-000000000002",
    );
    const source = {
      kind: "GIFT" as const,
      fields: {
        title: "Gift",
        shortDescription: "A gift",
        description: "Description",
        fulfillmentDescription: "Prepared by the studio",
        variantLabels: [
          { giftVariantId: first, label: "Small" },
          { giftVariantId: second, label: "Large" },
        ],
        seoTitle: "Gift",
        seoDescription: "Description",
      },
    };
    expect(emptyFields(source)["variantLabels"]).toEqual([
      { giftVariantId: first, label: "" },
      { giftVariantId: second, label: "" },
    ]);
    expect(
      editableFields(source, {
        variantLabels: [
          { giftVariantId: first, label: "小份" },
          { giftVariantId: "obsolete", label: "旧规格" },
        ],
      })["variantLabels"],
    ).toEqual([
      { giftVariantId: first, label: "小份" },
      { giftVariantId: second, label: "" },
    ]);
    expect(editableFields(source)).toMatchObject({
      subtitle: "",
      safetyNotice: "",
    });
  });
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
