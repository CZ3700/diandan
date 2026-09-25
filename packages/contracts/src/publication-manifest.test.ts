import { describe, expect, test } from "vitest";
import * as manifest from "./publication-manifest.js";
import { SUPPORTED_LOCALES } from "./locale.js";

const id = "81000000-0000-4000-8000-000000000001";
const editor = "81000000-0000-4000-8000-000000000002";
const reviewer = "81000000-0000-4000-8000-000000000003";
const hash = "a".repeat(64);
const time = "2026-09-06T10:00:00.123456Z";
const owner = { kind: "POLICY", policyKey: "terms" };
function revision() {
  return {
    schemaVersion: 1,
    target: owner,
    revisionId: id,
    revisionNumber: 1,
    createdBy: editor,
    createdAt: time,
    content: {
      kind: "POLICY",
      structure: { kind: "TERMS", effectiveAt: time },
      translations: SUPPORTED_LOCALES.map((locale) => ({
        locale,
        origin: "HUMAN",
        fields: { title: "Terms", summary: "Summary", body: "Policy" },
      })),
    },
    translationAudits: SUPPORTED_LOCALES.map((locale, i) => ({
      id: `82000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      reviewId: `83000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      reviewSequence: 3,
      locale,
      sourceHash: hash,
      translatedFromSourceHash: hash,
      origin: "HUMAN",
      editorId: editor,
      editedAt: time,
      review: {
        status: "APPROVED",
        reviewerId: reviewer,
        reviewedAt: time,
        reviewedSourceHash: hash,
        reviewedContentHash: hash,
      },
    })),
    extensions: {},
  };
}

describe("immutable publication manifest contract", () => {
  test("defines independent versioned bundle and publication record roots", () => {
    for (const name of [
      "publicationManifestSchema",
      "publicationManifestRecordSchema",
      "publicationManifestRevisionSchema",
    ])
      expect(manifest).toHaveProperty(name);
  });
  test("retains actual seven locale text, audit identities and original Unicode", () => {
    const value = revision();
    value.content.translations[0]!.fields.title = "Cafe\u0301";
    expect(manifest.publicationManifestRevisionSchema.parse(value)).toEqual(
      value,
    );
  });
  test("does not permit mutable lifecycle, head or snapshot hashes in immutable revision", () => {
    for (const extra of [
      { lifecycle: { status: "PUBLISHED" } },
      { headVersion: 2 },
      { contentHash: hash },
    ])
      expect(
        manifest.publicationManifestRevisionSchema.safeParse({
          ...revision(),
          ...extra,
        }).success,
      ).toBe(false);
  });
  test("rejects missing locale, unapproved audit and mismatched owner kind", () => {
    const missing = revision();
    missing.content.translations.pop();
    missing.translationAudits.pop();
    expect(
      manifest.publicationManifestRevisionSchema.safeParse(missing).success,
    ).toBe(false);
    const unapproved = revision();
    Object.assign(unapproved.translationAudits[0]!, {
      review: { status: "DRAFT" },
    });
    expect(
      manifest.publicationManifestRevisionSchema.safeParse(unapproved).success,
    ).toBe(false);
    expect(
      manifest.publicationManifestRevisionSchema.safeParse({
        ...revision(),
        target: { kind: "HOMEPAGE" },
      }).success,
    ).toBe(false);
  });
  test("binary proof excludes current rights and processing flags", () => {
    const asset = {
      schemaVersion: 1,
      id,
      checksumSha256: hash,
      mimeType: "image/png",
      width: 800,
      height: 1000,
      byteSize: 1234,
      objectKey: "media/image.png",
      createdAt: time,
    };
    expect(
      manifest.publicationManifestAssetSchema.safeParse(asset).success,
    ).toBe(true);
    for (const extra of [
      { rightsStatus: "APPROVED" },
      { rightsReference: "private rights" },
      { processingStatus: "READY" },
    ])
      expect(
        manifest.publicationManifestAssetSchema.safeParse({
          ...asset,
          ...extra,
        }).success,
      ).toBe(false);
  });
});
