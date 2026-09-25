import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

describe("admin content contract surface", () => {
  it("exports strict command, authorization, review and scoped preview roots", () => {
    for (const name of [
      "adminContentCommandSchema",
      "adminContentResponseSchema",
      "adminAuthorizationCommandSchema",
      "adminAuthorizationResponseSchema",
      "contentReviewContextSchema",
      "contentPreviewRequestSchema",
      "contentPreviewResponseSchema",
    ]) {
      expect(contracts).toHaveProperty(name);
    }
  });
});

const id = "10000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);
const hash = "a".repeat(64);
it("rejects browser-supplied authority, noncanonical secrets and unbounded grants", () => {
  const command = {
    schemaVersion: 1,
    action: "ISSUE_PREVIEW",
    target: { kind: "IDOL_ALIASES", revisionId: id, locale: "ja" },
    ttlSeconds: 300,
    reasonCode: "EDITOR_PREVIEW",
  };
  expect(contracts.adminContentCommandSchema.safeParse(command).success).toBe(
    true,
  );
  for (const extra of [
    { actorId: id },
    { reviewerId: id },
    { issuedAt: "2026-09-05T00:00:00Z" },
    { token },
  ])
    expect(
      contracts.adminContentCommandSchema.safeParse({ ...command, ...extra })
        .success,
    ).toBe(false);
  expect(
    contracts.adminContentCommandSchema.safeParse({
      ...command,
      ttlSeconds: 901,
    }).success,
  ).toBe(false);
  expect(
    contracts.adminContentRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: id,
      sessionToken: token,
      csrfToken: token,
      command,
    }).success,
  ).toBe(true);
  expect(
    contracts.adminContentRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: id,
      sessionToken: "A".repeat(42) + "B",
      csrfToken: token,
      command,
    }).success,
  ).toBe(false);
});
it("rejects unrelated preview language/kind and failure nested in successful draft", () => {
  expect(
    contracts.contentPreviewResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { kind: "GIFT_DETAILS", revisionId: id, locale: "en" },
      content: { kind: "IDOL_ALIASES", aliases: [] },
    }).success,
  ).toBe(false);
  expect(
    contracts.contentPreviewResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { kind: "IDOL_ALIASES", revisionId: id, locale: "en" },
      content: {
        kind: "IDOL_ALIASES",
        aliases: [{ id: "name", locale: "ja", text: "Fixture" }],
      },
    }).success,
  ).toBe(false);
  expect(
    contracts.adminContentResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "DRAFT",
      content: { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" },
      reviews: [],
    }).success,
  ).toBe(false);
});
it("requires review source hash only for actual translated detail targets", () => {
  const review = {
    schemaVersion: 1,
    action: "APPROVE_REVIEW",
    target: { kind: "IDOL_ALIASES", revisionId: id },
    expectedVersion: 2,
    expectedContentHash: hash,
    expectedSourceHash: null,
    reasonCode: "CONTENT_REVIEWED",
    idempotencyKey: "fixture-key-review",
  };
  expect(contracts.adminContentCommandSchema.safeParse(review).success).toBe(
    true,
  );
  expect(
    contracts.adminContentCommandSchema.safeParse({
      ...review,
      expectedSourceHash: hash,
    }).success,
  ).toBe(false);
  expect(
    contracts.adminContentCommandSchema.safeParse({
      ...review,
      target: { kind: "GIFT_DETAILS", revisionId: id, locale: "th" },
    }).success,
  ).toBe(false);
});
it("permits a dedicated assigned-language review read without asking for all translations", () => {
  expect(
    contracts.adminContentCommandSchema.safeParse({
      schemaVersion: 1,
      action: "READ_REVIEW",
      target: { kind: "GIFT_DETAILS", revisionId: id, locale: "ja" },
    }).success,
  ).toBe(true);
});
