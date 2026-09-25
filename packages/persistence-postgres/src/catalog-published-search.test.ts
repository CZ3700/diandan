import { describe, expect, test, vi } from "vitest";
import {
  publicationManifestSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import {
  computeIdolTranslationContentHash,
  computeIdolAliasContentHash,
} from "@fan-support/content";
import { writePublishedIdolSearchProjections } from "./catalog-search-projection.js";

const id = (n: number) =>
  `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const fields = {
    displayName: " Ｖａｌｅ ",
    shortBio: "Artist",
    fullBio: "Artist",
    seoTitle: "Artist",
    seoDescription: "Artist",
  };
  const hash = computeIdolTranslationContentHash(fields),
    at = "2026-09-06T00:00:00.000001Z";
  const aliases = [
    { id: "universal", locale: null, text: " Ｓｔａｒ " },
    { id: "japanese", locale: "ja", text: "明星" },
  ];
  const aliasHash = computeIdolAliasContentHash(aliases);
  return publicationManifestSchema.parse({
    schemaVersion: 1,
    target: { owner: { kind: "IDOL", idolId: id(1) }, revisionId: id(2) },
    revision: {
      schemaVersion: 1,
      target: { kind: "IDOL", idolId: id(1) },
      revisionId: id(2),
      revisionNumber: 1,
      createdBy: id(3),
      createdAt: at,
      content: {
        kind: "IDOL",
        structure: {
          themeAccent: "#abcdef",
          heroTextTone: "light",
          displayOrder: 0,
        },
        media: [],
        aliases,
        translations: SUPPORTED_LOCALES.map((locale) => ({
          locale,
          origin: "HUMAN",
          fields,
        })),
      },
      translationAudits: SUPPORTED_LOCALES.map((locale, i) => ({
        id: id(10 + i),
        reviewId: id(20 + i),
        reviewSequence: 3,
        locale,
        sourceHash: hash,
        translatedFromSourceHash: hash,
        origin: "HUMAN",
        editorId: id(3),
        editedAt: at,
        review: {
          status: "APPROVED",
          reviewerId: id(4),
          reviewedAt: at,
          reviewedSourceHash: hash,
          reviewedContentHash: hash,
        },
      })),
      extensions: {
        aliases: {
          schemaVersion: 1,
          id: id(30),
          idolRevisionId: id(2),
          aliases,
          contentHash: aliasHash,
          editorId: id(3),
          editedAt: at,
          review: {
            status: "APPROVED",
            reviewerId: id(4),
            reviewedAt: at,
            reviewedContentHash: aliasHash,
          },
        },
      },
    },
    mediaRevisions: [],
    approvals: [],
    copies: [],
    extensionApprovals: [
      {
        kind: "IDOL_ALIASES",
        revisionId: id(2),
        subjectId: id(30),
        reviewId: id(31),
        sequence: 3,
        auditLogId: id(32),
        editorId: id(3),
        structureEditorId: id(3),
        reviewerId: id(4),
        editedAt: at,
        reviewedAt: at,
        contentHash: aliasHash,
        sourceHash: null,
      },
    ],
    media: { assets: [], variants: [], lineage: [] },
  });
}
describe("publication atomic search projection", () => {
  test("writes every name and approved alias using canonical source hashes", async () => {
    const query = vi
      .fn<(...args: [string, unknown[]?]) => Promise<unknown>>()
      .mockResolvedValue({ rows: [] });
    const manifest = fixture();
    await writePublishedIdolSearchProjections({ query }, manifest);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toContain(
      "idol_translation_search_projections",
    );
    expect(query.mock.calls[0]![1]?.[2]).toEqual(
      SUPPORTED_LOCALES.map(() => "vale"),
    );
    expect(query.mock.calls[1]![0]).toContain("idol_alias_search_projections");
    expect(query.mock.calls[1]![1]?.[1]).toEqual(["universal", "japanese"]);
    expect(query.mock.calls[1]![1]?.[3]).toEqual(["star", "明星"]);
    expect(manifest.revision.content.translations[0]!.fields).toHaveProperty(
      "displayName",
      " Ｖａｌｅ ",
    );
    expect(query.mock.calls.map((row) => row[0]).join("\n")).not.toContain(
      "UPDATE public.idol_revision_translations",
    );
  });
  test("forged source hash or unapproved alias cannot create a search projection", async () => {
    const query = vi.fn();
    const manifest = fixture();
    if (manifest.revision.content.kind !== "IDOL") throw new Error("fixture");
    manifest.revision.content.translations[0]!.fields.displayName = "tampered";
    await expect(
      writePublishedIdolSearchProjections({ query }, manifest),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    const unapproved = fixture();
    unapproved.revision.extensions.aliases!.review = { status: "DRAFT" };
    await expect(
      writePublishedIdolSearchProjections({ query }, unapproved),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  test("missing independent alias evidence fails before either projection write", async () => {
    const query = vi.fn();
    const manifest = fixture();
    manifest.extensionApprovals = [];
    await expect(
      writePublishedIdolSearchProjections({ query }, manifest),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
