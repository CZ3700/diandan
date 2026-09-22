import { expect, test } from "vitest";
import { adminPaymentConfigurationResponseSchema } from "@fan-support/contracts";
const subject = await import("./authority").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
function workspace(
  canEdit: boolean,
  canPublish: boolean,
  lifecycle: string,
  currentRevisionId: string | null = null,
) {
  const value = adminPaymentConfigurationResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "WORKSPACE",
    actorId: id,
    canEdit,
    canPublish,
    reviewLocales: [],
    currentPublicationId: null,
    currentRevisionId,
    generation: 0,
    accounts: [],
    selected: {
      revisionId: id,
      version: 1,
      lifecycle,
      createdAt: "2026-09-22T00:00:00Z",
      createdBy: id,
      configuration: { schemaVersion: 1, channels: [], routes: [] },
      reviews: [],
    },
    history: [
      {
        revisionId: id,
        version: 1,
        lifecycle,
        createdAt: "2026-09-22T00:00:00Z",
        wasPublished: lifecycle === "PUBLISHED" || lifecycle === "SUPERSEDED",
      },
    ],
  });
  if (value.outcome !== "SUCCESS" || value.kind !== "WORKSPACE")
    throw new Error("fixture");
  return value;
}
test("configuration editors can preflight drafts independently of publication permission", () => {
  expect(subject?.availableValidationModes).toBeTypeOf("function");
  expect(
    subject!.availableValidationModes(workspace(true, false, "DRAFT")),
  ).toEqual(["PUBLISH"]);
  expect(
    subject!.availableValidationModes(workspace(false, true, "DRAFT")),
  ).toEqual([]);
});
test("current published and archived versions cannot misleadingly offer a publish or rollback command", () => {
  expect(
    subject!.availableValidationModes(workspace(true, true, "PUBLISHED", id)),
  ).toEqual([]);
  expect(
    subject!.availableValidationModes(workspace(true, true, "ARCHIVED")),
  ).toEqual([]);
  expect(
    subject!.availableValidationModes(workspace(true, true, "SUPERSEDED")),
  ).toEqual(["ROLLBACK"]);
  expect(
    subject!.availableValidationModes(workspace(true, true, "SUPERSEDED", id)),
  ).toEqual([]);
});
