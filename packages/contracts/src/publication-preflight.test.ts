import { describe, expect, test } from "vitest";
import * as preflight from "./publication-preflight.js";
const id = "71000000-0000-4000-8000-000000000001";
const target = {
  owner: { kind: "POLICY", policyKey: "terms" },
  revisionId: id,
};
const command = { schemaVersion: 1, target, action: "PUBLISH" };
const response = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLICATION_PREFLIGHT",
  target,
  action: "PUBLISH",
  headVersion: 0,
  contentHash: "a".repeat(64),
  evaluatedAt: "2026-09-06T10:00:00.123456Z",
  ready: true,
  issues: [],
};

describe("publication preflight contract", () => {
  test("defines strict request, response and canonical context boundaries", () => {
    for (const name of [
      "publicationPreflightCommandSchema",
      "publicationPreflightRequestSchema",
      "publicationPreflightResponseSchema",
      "publicationPreflightContextSchema",
      "publicationPreflightContextResponseSchema",
    ])
      expect(preflight).toHaveProperty(name);
  });
  test("accepts five typed owners and two read-only intent actions", () => {
    for (const owner of [
      { kind: "IDOL", idolId: id },
      { kind: "GIFT", giftId: id },
      { kind: "HOMEPAGE" },
      { kind: "POLICY", policyKey: "terms" },
      { kind: "MEDIA_METADATA", mediaAssetId: id },
    ])
      for (const action of ["PUBLISH", "ROLLBACK"])
        expect(
          preflight.publicationPreflightCommandSchema.safeParse({
            ...command,
            target: { owner, revisionId: id },
            action,
          }).success,
        ).toBe(true);
  });
  test("rejects caller supplied authority, content or optimistic write hints", () => {
    for (const extra of [
      { actorId: id },
      { candidate: {} },
      { approved: true },
      { expectedVersion: 1 },
      { idempotencyKey: "test-key" },
      { locale: "ja" },
    ])
      expect(
        preflight.publicationPreflightCommandSchema.safeParse({
          ...command,
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      preflight.publicationPreflightCommandSchema.safeParse({
        ...command,
        action: "VALIDATE",
      }).success,
    ).toBe(false);
    expect(
      preflight.publicationPreflightCommandSchema.safeParse({
        ...command,
        target: { ...target, locale: "ja" },
      }).success,
    ).toBe(false);
  });
  test("retains the opaque current-session request envelope", () => {
    const request = {
      schemaVersion: 1,
      requestId: id,
      sessionToken: "A".repeat(43),
      csrfToken: "B".repeat(42) + "A",
      command,
    };
    expect(
      preflight.publicationPreflightRequestSchema.safeParse(request).success,
    ).toBe(true);
    expect(
      preflight.publicationPreflightRequestSchema.safeParse({
        ...request,
        actorId: id,
      }).success,
    ).toBe(false);
  });
  test("head version zero and microsecond evaluation remain representable", () => {
    expect(
      preflight.publicationPreflightResponseSchema.parse(response),
    ).toEqual(response);
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        headVersion: -1,
      }).success,
    ).toBe(false);
  });
  test("readiness is exactly blocker absence while warnings remain visible", () => {
    const issue = {
      code: "OPTIONAL_FIELD_MISSING",
      severity: "WARNING",
      path: ["translations", "caption"],
      locale: "ja",
    };
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        issues: [issue],
      }).success,
    ).toBe(true);
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        issues: [{ ...issue, severity: "BLOCKER" }],
      }).success,
    ).toBe(false);
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        ready: false,
        issues: [{ ...issue, severity: "BLOCKER" }],
      }).success,
    ).toBe(true);
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        ready: false,
      }).success,
    ).toBe(false);
    expect(
      preflight.publicationPreflightResponseSchema.safeParse({
        ...response,
        token: "private",
      }).success,
    ).toBe(false);
  });
});
test("canonical context requires a typed historical publication slot", () => {
  expect(preflight.publicationPreflightContextSchema.shape).toHaveProperty(
    "previousPublication",
  );
});
