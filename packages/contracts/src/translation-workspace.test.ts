import { expect, test } from "vitest";

const modulePath = "./translation-workspace.js";
test("workspace exposes a narrow exact-locale request, never an all-language snapshot request", async () => {
  const exports = await import(modulePath).catch(() => ({}));
  expect(exports.translationWorkspaceCommandSchema).toBeDefined();
  const schema = exports.translationWorkspaceCommandSchema;
  expect(
    schema.safeParse({
      schemaVersion: 1,
      action: "READ",
      target: {
        owner: { kind: "HOMEPAGE" },
        revisionId: "10000000-0000-4000-8000-000000000001",
        locale: "ja",
      },
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      schemaVersion: 1,
      action: "READ",
      target: {
        owner: { kind: "HOMEPAGE" },
        revisionId: "10000000-0000-4000-8000-000000000001",
        locale: "ja",
      },
      editorId: "injected",
    }).success,
  ).toBe(false);
});

test("workspace rejects inconsistent matrix, source and editability projections", async () => {
  const { translationWorkspaceResponseSchema } =
    await import("./translation-workspace.js");
  const { SUPPORTED_LOCALES } = await import("./locale.js");
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "TRANSLATION_WORKSPACE",
    target: {
      owner: { kind: "POLICY", policyKey: "terms" },
      revisionId: "10000000-0000-4000-8000-000000000001",
      locale: "ja",
    },
    revisionNumber: 1,
    authoringHeadVersion: 1,
    contentHash: "a".repeat(64),
    lifecycle: { status: "DRAFT" },
    cells: SUPPORTED_LOCALES.map((locale) =>
      locale === "ja"
        ? { locale, access: "READABLE", status: "MISSING", reviewStatus: null }
        : { locale, access: "RESTRICTED" },
    ),
    source: {
      kind: "POLICY",
      fields: {
        title: "Terms",
        summary: "Terms summary",
        body: "<p>Terms body</p>",
      },
    },
    selected: null,
    sourceDiff: { status: "CURRENT", previous: null, changedPaths: [] },
    editability: {
      canSave: false,
      reason: "FORBIDDEN",
      requiredLocales: ["ja"],
    },
  };
  expect(translationWorkspaceResponseSchema.safeParse(value).success).toBe(
    true,
  );
  expect(
    translationWorkspaceResponseSchema.safeParse({
      ...value,
      editability: { ...value.editability, canSave: true },
    }).success,
  ).toBe(false);
  expect(
    translationWorkspaceResponseSchema.safeParse({
      ...value,
      sourceDiff: { ...value.sourceDiff, status: "AVAILABLE" },
    }).success,
  ).toBe(false);
  expect(
    translationWorkspaceResponseSchema.safeParse({
      ...value,
      cells: value.cells.map((cell) =>
        cell.locale === "ja"
          ? { ...cell, status: "APPROVED", reviewStatus: "APPROVED" }
          : cell,
      ),
    }).success,
  ).toBe(false);
  expect(
    translationWorkspaceResponseSchema.safeParse({
      ...value,
      authoringHeadVersion: 0,
    }).success,
  ).toBe(false);
});
