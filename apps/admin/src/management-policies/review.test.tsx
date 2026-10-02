import { expect, test } from "vitest";
import { actor, policyFixture } from "./fixture";
const subject = await import("./review").catch(() => undefined);
test("review permissions require the actual editor for submission and a separate authorized reviewer for approval", () => {
  expect(subject?.policyReviewAccess).toBeTypeOf("function");
  const workspace = policyFixture();
  if (workspace.outcome !== "SUCCESS" || !workspace.selected)
    throw new Error("fixture");
  const input = {
    workspace,
    actorId: actor,
    permissions: ["content.edit", "content.translation.review"] as const,
    localeScopes: ["en"] as const,
    dirty: false,
  };
  expect(subject!.policyReviewAccess(input)).toEqual({
    submit: true,
    approve: false,
    independent: false,
  });
  workspace.selected.context.audit.review = {
    status: "IN_REVIEW",
    submittedAt: "2026-10-03T01:00:00Z",
  };
  expect(subject!.policyReviewAccess(input).approve).toBe(false);
  expect(
    subject!.policyReviewAccess({ ...input, actorId: "other" }).approve,
  ).toBe(true);
  expect(
    subject!.policyReviewAccess({ ...input, actorId: "other", dirty: true })
      .approve,
  ).toBe(false);
  expect(
    subject!.policyReviewAccess({
      ...input,
      actorId: "other",
      localeScopes: [],
    }).approve,
  ).toBe(false);
  workspace.selected.context.stale = true;
  expect(
    subject!.policyReviewAccess({ ...input, actorId: "other" }).approve,
  ).toBe(false);
});
