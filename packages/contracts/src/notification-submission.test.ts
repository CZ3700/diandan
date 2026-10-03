import { describe, expect, test } from "vitest";
import * as contracts from "./index.js";

const schemas = contracts as unknown as Record<
  string,
  { safeParse(value: unknown): { success: boolean } }
>;
const id = "12345678-1234-4234-8234-123456789012";
const claim = {
  schemaVersion: 1,
  transportKey: "a".repeat(64),
  idempotencyKey: `notification:${id}`,
  notificationId: id,
  requestHash: "b".repeat(64),
  dispatchNotAfter: "2026-09-29T01:00:00.000Z",
  claimToken: id,
};
const accepted = {
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "SUCCESS",
  value: {
    status: "ACCEPTED",
    providerReference: "provider-reference",
    acceptedAt: "2026-09-29T00:00:00.000Z",
  },
};
const failure = (code: string) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: { schemaVersion: 1, code, recovery: "NONE" },
});

describe("native mail submission contracts", () => {
  test("defines an explicit native profile without accepting the gateway protocol", () => {
    const schema = schemas["notificationZeptoMailProfileSchema"];
    expect(schema).toBeDefined();
    const profile = {
      schemaVersion: 1,
      protocol: "zeptomail-v1",
      environment: "TEST",
      apiOrigin: "https://mail.example.test",
      fromEmail: "sender@example.test",
      fromName: "Studio",
      replyToEmail: "support@example.test",
      timeoutMs: 2000,
      idempotencyRetentionSeconds: 3600,
    };
    expect(schema!.safeParse(profile).success).toBe(true);
    for (const changed of [
      { ...profile, protocol: "fan-support-mail-v1" },
      { ...profile, apiOrigin: "http://mail.example.test" },
      { ...profile, credential: "not-part-of-profile" },
      { ...profile, fromName: "bad\r\nheader" },
    ])
      expect(schema!.safeParse(changed).success).toBe(false);
  });

  test("claims bind exact dispatch identity without permitting mail content", () => {
    const schema = schemas["notificationSubmissionClaimCommandSchema"];
    expect(schema).toBeDefined();
    expect(schema!.safeParse(claim).success).toBe(true);
    for (const changed of [
      { ...claim, transportKey: "a" },
      { ...claim, requestHash: "b" },
      { ...claim, claimToken: "opaque" },
      { ...claim, recipient: "private@example.test" },
      { ...claim, body: "mail content" },
      { ...claim, dispatchNotAfter: "infinity" },
    ])
      expect(schema!.safeParse(changed).success).toBe(false);
  });

  test("replay is explicit and unknown never carries a fabricated result", () => {
    const schema = schemas["notificationSubmissionClaimResultSchema"];
    expect(schema).toBeDefined();
    for (const decision of ["SEND", "UNKNOWN", "CONFLICT", "EXPIRED"])
      expect(schema!.safeParse({ schemaVersion: 1, decision }).success).toBe(
        true,
      );
    expect(
      schema!.safeParse({
        schemaVersion: 1,
        decision: "REPLAY",
        result: accepted,
      }).success,
    ).toBe(true);
    expect(
      schema!.safeParse({ schemaVersion: 1, decision: "REPLAY" }).success,
    ).toBe(false);
    expect(
      schema!.safeParse({
        schemaVersion: 1,
        decision: "UNKNOWN",
        result: accepted,
      }).success,
    ).toBe(false);
  });

  test("only definite normalized results can finalize a submission", () => {
    const schema = schemas["notificationSubmissionFinishCommandSchema"];
    expect(schema).toBeDefined();
    expect(schema!.safeParse({ ...claim, result: accepted }).success).toBe(
      true,
    );
    expect(
      schema!.safeParse({ ...claim, result: failure("RECIPIENT_REJECTED") })
        .success,
    ).toBe(true);
    for (const code of [
      "TIMEOUT_OUTCOME_UNKNOWN",
      "MALFORMED_PROVIDER_RESPONSE",
      "UNEXPECTED_ADAPTER_FAILURE",
    ])
      expect(
        schema!.safeParse({ ...claim, result: failure(code) }).success,
      ).toBe(false);
    expect(
      schema!.safeParse({
        ...claim,
        result: {
          ...failure("RATE_LIMITED"),
          error: {
            schemaVersion: 1,
            code: "RATE_LIMITED",
            recovery: "RETRY_SAME_COMMAND",
            retryAfterMs: 1000,
          },
        },
      }).success,
    ).toBe(true);
  });
});
