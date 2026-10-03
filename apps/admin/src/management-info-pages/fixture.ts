import {
  SUPPORTED_LOCALES,
  sourceHashSchema,
  type InformationPageWorkspace,
} from "@fan-support/contracts";
export const sectionId = "10000000-0000-4000-8000-000000000001";
export const revisionId = "10000000-0000-4000-8000-000000000002";
export const hash = sourceHashSchema.parse("a".repeat(64));
export function informationFixture(): InformationPageWorkspace {
  const fields = {
    title: "About",
    summary: "Summary",
    sections: [{ id: sectionId, heading: "Story", body: "Test information" }],
  };
  const structure = { sectionIds: [sectionId], contactEmail: null };
  return {
    schemaVersion: 1,
    pageKey: "ABOUT",
    locale: "en",
    version: 1,
    draft: {
      revisionId,
      createdAt: "2026-09-28T00:00:00Z",
      structure,
      sourceHash: hash,
    },
    published: null,
    source: fields,
    previousSource: null,
    changedPaths: [],
    selected: {
      translationId: "10000000-0000-4000-8000-000000000003",
      fields,
      contentHash: hash,
      translatedFromSourceHash: hash,
      editorId: "10000000-0000-4000-8000-000000000004",
      editedAt: "2026-09-28T00:00:00Z",
      review: {
        status: "DRAFT",
        sequence: 1,
        reviewerId: null,
        reviewedAt: null,
      },
    },
    cells: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      access: "READABLE",
      status: locale === "en" ? "DRAFT" : "MISSING",
    })),
    capabilities: {
      canSave: true,
      canSubmit: true,
      canApprove: false,
      canPublish: false,
      canUnpublish: false,
      canRestore: false,
    },
    blockers: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      code: locale === "en" ? "DRAFT" : "MISSING",
    })),
    preview: {
      schemaVersion: 1,
      pageKey: "ABOUT",
      locale: "en",
      revisionId,
      structure,
      fields,
      sourceStatus: "CURRENT",
    },
  };
}
