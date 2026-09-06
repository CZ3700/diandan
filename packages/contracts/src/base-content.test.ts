import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

const id = "00000000-0000-4000-8000-000000000001";
const target = {
  owner: { kind: "IDOL", idolId: id },
  revisionId: id,
  locale: "ja",
};
const command = {
  schemaVersion: 1,
  action: "SUBMIT_REVIEW",
  target,
  expectedVersion: 1,
  expectedContentHash: "a".repeat(64),
  expectedSourceHash: "b".repeat(64),
  reasonCode: "TRANSLATION_SUBMIT",
  idempotencyKey: "base-review-test-1",
};

describe("five-kind base review and preview contracts", () => {
  it("adds versioned boundaries while leaving the old extension command closed", () => {
    expect(contracts).toHaveProperty("baseContentCommandSchema");
    expect(contracts).toHaveProperty("baseContentReviewResponseSchema");
    expect(contracts).toHaveProperty("baseContentPreviewResponseSchema");
    expect(contracts.adminContentCommandSchema.safeParse(command).success).toBe(
      false,
    );
  });
  it("binds review commands to owner, revision, locale and current source evidence", () => {
    expect(contracts.baseContentCommandSchema.safeParse(command).success).toBe(
      true,
    );
    for (const changes of [
      { schemaVersion: 2 },
      { actorId: id },
      { expectedVersion: Number.MAX_SAFE_INTEGER },
      { expectedSourceHash: null },
      { target: { ...target, locale: "fr" } },
      { target: { ...target, owner: { kind: "GIFT", idolId: id } } },
    ]) {
      expect(
        contracts.baseContentCommandSchema.safeParse({ ...command, ...changes })
          .success,
      ).toBe(false);
    }
  });
  it("bounds preview grants and keeps authority fields outside browser commands", () => {
    const issue = {
      schemaVersion: 1,
      action: "ISSUE_PREVIEW",
      target,
      ttlSeconds: 900,
      reasonCode: "CONTENT_PREVIEW",
    };
    expect(contracts.baseContentCommandSchema.safeParse(issue).success).toBe(
      true,
    );
    for (const changes of [
      { ttlSeconds: 901 },
      { ttlSeconds: 59 },
      { sessionId: id },
      { tokenDigest: "a".repeat(64) },
      { idempotencyKey: "not-replayable" },
    ]) {
      expect(
        contracts.baseContentCommandSchema.safeParse({ ...issue, ...changes })
          .success,
      ).toBe(false);
    }
  });
  it("retains stale provenance for read while rejecting inconsistent locale or stale flags", () => {
    const context = {
      schemaVersion: 1,
      target,
      structureEditorId: id,
      lifecycle: { status: "DRAFT" },
      currentEnglishSourceHash: "b".repeat(64),
      stale: true,
      audit: {
        id,
        reviewId: id,
        reviewSequence: 1,
        locale: "ja",
        sourceHash: "a".repeat(64),
        translatedFromSourceHash: "c".repeat(64),
        origin: "HUMAN",
        editorId: id,
        editedAt: "2026-01-01T00:00:00.123456Z",
        review: { status: "DRAFT" },
      },
    };
    expect(
      contracts.baseContentReviewContextSchema.safeParse(context).success,
    ).toBe(true);
    expect(
      contracts.baseContentReviewContextSchema.safeParse({
        ...context,
        stale: false,
      }).success,
    ).toBe(false);
    expect(
      contracts.baseContentReviewContextSchema.safeParse({
        ...context,
        audit: { ...context.audit, locale: "vi" },
      }).success,
    ).toBe(false);
  });
  it("requires localized output to match the grant and excludes audit or other locale data", () => {
    const payload = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      target,
      content: {
        kind: "IDOL",
        structure: {
          themeAccent: "#aabbcc",
          heroTextTone: "light",
          displayOrder: 0,
        },
        media: [],
        fields: {
          displayName: "Fixture",
          shortBio: "Fixture",
          fullBio: "<p>Fixture</p>",
          seoTitle: "Fixture",
          seoDescription: "Fixture",
        },
        aliases: [{ id: "stage-name", text: "Fixture", locale: "ja" }],
      },
    };
    // An absent alias list remains a valid base-only revision.
    const content = {
      kind: payload.content.kind,
      structure: payload.content.structure,
      media: payload.content.media,
      fields: payload.content.fields,
    };
    expect(
      contracts.baseContentPreviewResponseSchema.safeParse(payload).success,
    ).toBe(true);
    expect(
      contracts.baseContentPreviewResponseSchema.safeParse({
        ...payload,
        content: {
          ...payload.content,
          aliases: [{ id: "stage-name", text: "Fixture", locale: "th" }],
        },
      }).success,
    ).toBe(false);
    expect(
      contracts.baseContentPreviewResponseSchema.safeParse({
        ...payload,
        content,
      }).success,
    ).toBe(true);
    expect(
      contracts.baseContentPreviewResponseSchema.safeParse({
        ...payload,
        content: { ...content, editorId: id },
      }).success,
    ).toBe(false);
    expect(
      contracts.baseContentPreviewResponseSchema.safeParse({
        ...payload,
        content,
        target: { ...target, owner: { kind: "GIFT", giftId: id } },
      }).success,
    ).toBe(false);
  });
});
