import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
const policy = {
  schemaVersion: 1,
  providerAccountId: "a1000000-0000-4000-8000-000000000001",
  environment: "TEST",
  version: 1,
  failureThreshold: 3,
  failureWindowMs: 60000,
  openDurationMs: 30000,
  probeLeaseMs: 10000,
  probeRetryMs: 30000,
};
const now = "2026-09-21T18:00:00.000Z";
const initial = {
  schemaVersion: 1,
  now,
  windowStartedAt: null,
  failureCount: 0,
  classification: "TECHNICAL_FAILURE",
  policy,
};
function advance(input: unknown): {
  schemaVersion: number;
  windowStartedAt: string | null;
  failureCount: number;
  thresholdReached: boolean;
} {
  const fn = (
    domain as unknown as Record<
      string,
      (input: unknown) => ReturnType<typeof advance>
    >
  )["advancePaymentHealthWindow"];
  expect(fn).toBeTypeOf("function");
  return fn!(input);
}
describe("deterministic fixed payment health failure window", () => {
  it("opens exactly at the threshold and caps counters", () => {
    expect(advance(initial)).toEqual({
      schemaVersion: 1,
      windowStartedAt: now,
      failureCount: 1,
      thresholdReached: false,
    });
    expect(
      advance({ ...initial, windowStartedAt: now, failureCount: 2 }),
    ).toEqual({
      schemaVersion: 1,
      windowStartedAt: now,
      failureCount: 3,
      thresholdReached: true,
    });
    expect(
      advance({ ...initial, windowStartedAt: now, failureCount: 3 })
        .failureCount,
    ).toBe(3);
  });
  it("expires only at the boundary and keeps backwards clock conservative", () => {
    const value = { ...initial, windowStartedAt: now, failureCount: 2 };
    expect(
      advance({ ...value, now: "2026-09-21T18:00:59.999Z" }).thresholdReached,
    ).toBe(true);
    expect(advance({ ...value, now: "2026-09-21T18:01:00.000Z" })).toEqual({
      schemaVersion: 1,
      windowStartedAt: "2026-09-21T18:01:00.000Z",
      failureCount: 1,
      thresholdReached: false,
    });
    expect(
      advance({ ...value, now: "2026-09-21T17:59:00.000Z" }).thresholdReached,
    ).toBe(true);
  });
  it.each(["SUCCESS", "BUSINESS_OUTCOME", "CONFIGURATION_ERROR"])(
    "%s cannot erase a newer failure or recover an open provider",
    (classification) => {
      expect(
        advance({
          ...initial,
          classification,
          windowStartedAt: now,
          failureCount: 2,
        }),
      ).toEqual({
        schemaVersion: 1,
        windowStartedAt: now,
        failureCount: 2,
        thresholdReached: false,
      });
      expect(advance({ ...initial, classification })).toEqual({
        schemaVersion: 1,
        windowStartedAt: null,
        failureCount: 0,
        thresholdReached: false,
      });
    },
  );
  it("rejects invalid input instead of inventing a default policy", () => {
    expect(() =>
      advance({ ...initial, policy: { ...policy, failureThreshold: 0 } }),
    ).toThrow();
  });
});
