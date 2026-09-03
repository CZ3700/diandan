import {
  contentTimestampSchema,
  decideIdempotencyInputSchema,
  type DecideIdempotencyInput,
  type IdempotencyDecision,
  type IdempotencyRecord,
  type IdempotencyRequestIdentity,
} from "@fan-support/contracts";

export type {
  DecideIdempotencyInput,
  IdempotencyDecision,
  IdempotencyRecord,
  IdempotencyRequestIdentity,
} from "@fan-support/contracts";

function sameScopeAndKey(
  request: IdempotencyRequestIdentity,
  record: IdempotencyRecord,
): boolean {
  return (
    request.actor === record.actor &&
    request.operation === record.operation &&
    request.key === record.key
  );
}

function isExpired(record: IdempotencyRecord, evaluatedAt: string): boolean {
  return Date.parse(record.expiresAt) <= Date.parse(evaluatedAt);
}

export function decideIdempotency(input: unknown): IdempotencyDecision {
  if (hasInvalidTimestamp(input)) {
    return {
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_TIMESTAMP",
    };
  }
  const parsed = decideIdempotencyInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_IDEMPOTENCY_INPUT",
    };
  }
  const value: DecideIdempotencyInput = parsed.data;
  const record = value.existingRecord;
  if (
    record === null ||
    !sameScopeAndKey(value.request, record) ||
    isExpired(record, value.evaluatedAt)
  ) {
    return { schemaVersion: 1, kind: "EXECUTE" };
  }

  if (value.request.canonicalRequestHash !== record.canonicalRequestHash) {
    return { schemaVersion: 1, kind: "CONFLICT" };
  }

  if (record.status === "IN_PROGRESS") {
    return { schemaVersion: 1, kind: "REPLAY", status: "IN_PROGRESS" };
  }

  return {
    schemaVersion: 1,
    kind: "REPLAY",
    status: record.status,
    safeResultRef: record.safeResultRef,
  };
}

function hasInvalidTimestamp(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const value = input as Record<string, unknown>;
  if (
    "evaluatedAt" in value &&
    !contentTimestampSchema.safeParse(value["evaluatedAt"]).success
  ) {
    return true;
  }
  const existingRecord = value["existingRecord"];
  return (
    typeof existingRecord === "object" &&
    existingRecord !== null &&
    "expiresAt" in existingRecord &&
    !contentTimestampSchema.safeParse(
      (existingRecord as Record<string, unknown>)["expiresAt"],
    ).success
  );
}
