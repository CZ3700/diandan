import { expect, test } from "vitest";

import {
  idempotencyDecisionSchema,
  idempotencyKeySchema,
} from "@fan-support/contracts";

import { decideIdempotency } from "./idempotency.js";

const request = {
  schemaVersion: 1 as const,
  actor: "cart:opaque-actor",
  operation: "checkout.create",
  key: idempotencyKeySchema.parse("idempotency-key-0001"),
  canonicalRequestHash: "sha256:request-a",
};

test("replays the safe result for the same live scope, key, and hash", () => {
  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request,
      existingRecord: {
        ...request,
        status: "SUCCEEDED",
        safeResultRef: "order:public-safe-reference",
        expiresAt: "2026-09-03T04:00:00.000Z",
      },
    }),
  ).toEqual({
    schemaVersion: 1,
    kind: "REPLAY",
    status: "SUCCEEDED",
    safeResultRef: "order:public-safe-reference",
  });
});

test("conflicts on the same live scope and key with a different hash", () => {
  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request: { ...request, canonicalRequestHash: "sha256:request-b" },
      existingRecord: {
        ...request,
        status: "IN_PROGRESS",
        expiresAt: "2026-09-03T04:00:00.000Z",
      },
    }),
  ).toEqual({ schemaVersion: 1, kind: "CONFLICT" });
});

test("allows a new execution when no matching live record exists or expiry is reached", () => {
  const expiredRecord = {
    ...request,
    status: "FAILED" as const,
    safeResultRef: "failure:safe-reference",
    expiresAt: "2026-09-03T03:00:00.000Z",
  };
  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: expiredRecord.expiresAt,
      request,
      existingRecord: expiredRecord,
    }).kind,
  ).toBe("EXECUTE");
  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request,
      existingRecord: null,
    }).kind,
  ).toBe("EXECUTE");
});

test("rejects records carrying raw request or PII fields", () => {
  const unsafeRecord = {
    ...request,
    status: "SUCCEEDED" as const,
    safeResultRef: "order:public-safe-reference",
    expiresAt: "2026-09-03T04:00:00.000Z",
    rawRequest: { fanMessage: "private-message" },
    email: "fan@example.invalid",
  };
  const decision = decideIdempotency({
    schemaVersion: 1,
    evaluatedAt: "2026-09-03T03:00:00.000Z",
    request,
    existingRecord: unsafeRecord,
  });
  const serialized = JSON.stringify(decision);
  expect(decision).toEqual({
    schemaVersion: 1,
    kind: "INVALID",
    reason: "INVALID_IDEMPOTENCY_INPUT",
  });
  expect(serialized).not.toContain("private-message");
  expect(serialized).not.toContain("fan@example.invalid");
  expect(serialized).not.toContain("fanMessage");
  expect(serialized).not.toContain("email");
  expect(serialized).not.toContain("rawRequest");
});

test("strictly validates the complete idempotency command and its decision", () => {
  const invalidInputs: unknown[] = [
    { schemaVersion: 1, request, existingRecord: null },
    {
      schemaVersion: 1,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request: { ...request, unexpected: true },
      existingRecord: null,
    },
    {
      schemaVersion: 2,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request,
      existingRecord: null,
    },
  ];

  for (const candidate of invalidInputs) {
    const decision = decideIdempotency(candidate);
    expect(decision).toEqual({
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_IDEMPOTENCY_INPUT",
    });
    expect(idempotencyDecisionSchema.safeParse(decision).success).toBe(true);
  }
});

test("fails closed when the evaluation or record expiry timestamp is invalid", () => {
  const existingRecord = {
    ...request,
    status: "IN_PROGRESS" as const,
    expiresAt: "2026-09-03T04:00:00.000Z",
  };

  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: "not-a-timestamp",
      request,
      existingRecord,
    }),
  ).toEqual({
    schemaVersion: 1,
    kind: "INVALID",
    reason: "INVALID_TIMESTAMP",
  });

  expect(
    decideIdempotency({
      schemaVersion: 1,
      evaluatedAt: "2026-09-03T03:00:00.000Z",
      request,
      existingRecord: { ...existingRecord, expiresAt: "not-a-timestamp" },
    }),
  ).toEqual({
    schemaVersion: 1,
    kind: "INVALID",
    reason: "INVALID_TIMESTAMP",
  });
});
