import {
  SUPPORTED_LOCALES,
  translationWorkspaceResponseSchema,
  adminCatalogOwnerSchema,
} from "@fan-support/contracts";
export const actor = "10000000-0000-4000-8000-000000000001";
export const revision = "10000000-0000-4000-8000-000000000002";
export const fields = {
  title: "Delivery",
  summary: "Delivery information",
  body: "<p>We prepare your gifts.</p>",
};
export const owner = adminCatalogOwnerSchema.parse({
  schemaVersion: 1,
  target: { kind: "POLICY", policyKey: "custom-delivery" },
  locale: "en",
  label: "Delivery",
  status: "draft",
  baseVersion: null,
  authoringVersion: 1,
  publicationHeadVersion: 0,
  latestRevisionId: revision,
  draftRevisionId: revision,
  publishedRevisionId: null,
  handle: null,
  acceptingGifts: null,
  createdAt: "2026-10-03T00:00:00Z",
});
export function policyFixture() {
  const target = { owner: owner.target, revisionId: revision, locale: "en" };
  const source = { kind: "POLICY", fields };
  return translationWorkspaceResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "TRANSLATION_WORKSPACE",
    target,
    revisionNumber: 1,
    authoringHeadVersion: 1,
    contentHash: "a".repeat(64),
    lifecycle: { status: "DRAFT" },
    cells: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      access: "READABLE",
      status: locale === "en" ? "DRAFT" : "MISSING",
      reviewStatus: locale === "en" ? "DRAFT" : null,
    })),
    source,
    selected: {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "REVIEW",
      context: {
        schemaVersion: 1,
        target,
        structureEditorId: actor,
        lifecycle: { status: "DRAFT" },
        audit: {
          id: revision,
          reviewId: revision,
          reviewSequence: 1,
          locale: "en",
          sourceHash: "b".repeat(64),
          translatedFromSourceHash: "b".repeat(64),
          origin: "MACHINE",
          editorId: actor,
          editedAt: "2026-10-03T00:00:00Z",
          review: { status: "DRAFT" },
        },
        currentEnglishSourceHash: "b".repeat(64),
        stale: false,
      },
      content: {
        kind: "POLICY",
        structure: { kind: "DELIVERY", effectiveAt: "2027-01-01T00:00:00Z" },
        fields,
      },
      source,
    },
    sourceDiff: { status: "CURRENT", previous: null, changedPaths: [] },
    editability: { canSave: true, reason: "ALLOWED", requiredLocales: ["en"] },
  });
}
