import { expect, test } from "vitest";
import fc from "fast-check";

import { idempotencyKeySchema } from "@fan-support/contracts";

import { decideIdempotency, type IdempotencyRecord } from "./idempotency.js";
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

test("same hash replays, different hash conflicts, and expired records execute", () => {
  const safeText = fc
    .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
      minLength: 1,
      maxLength: 32,
    })
    .map((characters) => characters.join(""));
  fc.assert(
    fc.property(
      safeText,
      safeText,
      fc.constantFrom("IN_PROGRESS", "SUCCEEDED", "FAILED"),
      (hash, suffix, status) => {
        const canonicalRequestHash = `sha256:${hash}`;
        const request = {
          schemaVersion: 1 as const,
          actor: "actor:test",
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
                safeResultRef: "result:safe",
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
              canonicalRequestHash: `${canonicalRequestHash}:${suffix}:different`,
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
