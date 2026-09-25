import { expect, test } from "vitest";
import fc from "fast-check";

import { idempotencyKeySchema } from "@fan-support/contracts";

import { decideIdempotency, type IdempotencyRecord } from "./idempotency.js";
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

test("same hash replays, different hash conflicts, and expired records execute", () => {
  const sha256Hex = fc
    .array(fc.constantFrom(..."abcdef0123456789"), {
      minLength: 64,
      maxLength: 64,
    })
    .map((characters) => characters.join(""));
  fc.assert(
    fc.property(
      sha256Hex,
      fc.constantFrom("IN_PROGRESS", "SUCCEEDED", "FAILED"),
      (canonicalRequestHash, status) => {
        const differentHash = `${canonicalRequestHash[0] === "a" ? "b" : "a"}${canonicalRequestHash.slice(1)}`;
        const request = {
          schemaVersion: 1 as const,
          actor: `actor-ref:v1:guest:${"a".repeat(64)}`,
          operation: "operation.test",
          key: idempotencyKeySchema.parse("idempotency-key-0001"),
          canonicalRequestHash,
        };
        const existingRecord: IdempotencyRecord =
          status === "IN_PROGRESS"
            ? {
                ...request,
                status,
                expiresAt: "2026-09-03T04:00:00.000Z",
              }
            : {
                ...request,
                status,
                safeResultRef: "error-ref:v1:REQUEST_REJECTED",
                expiresAt: "2026-09-03T04:00:00.000Z",
              };
        const live = {
          schemaVersion: 1 as const,
          evaluatedAt: "2026-09-03T03:00:00.000Z",
          request,
          existingRecord,
        };

        expect(decideIdempotency(live).kind).toBe("REPLAY");
        expect(
          decideIdempotency({
            ...live,
            request: {
              ...request,
              canonicalRequestHash: differentHash,
            },
          }).kind,
        ).toBe("CONFLICT");
        expect(
          decideIdempotency({
            ...live,
            evaluatedAt: existingRecord.expiresAt,
          }).kind,
        ).toBe("EXECUTE");
      },
    ),
    PROPERTY_PARAMETERS,
  );
});
