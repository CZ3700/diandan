import { expect, test } from "vitest";
import * as domain from "./index.js";

const input = {
  schemaVersion: 1,
  checkoutSessionId: "a1000000-0000-4000-8000-000000000001",
  providerAccountId: "a1000000-0000-4000-8000-000000000002",
  routeRuleId: "a1000000-0000-4000-8000-000000000003",
  providerRolloutBasisPoints: 10000,
  ruleRolloutBasisPoints: 10000,
};
type Decision = {
  schemaVersion: number;
  kind: string;
  algorithmVersion?: number;
  providerBucket?: number;
  ruleBucket?: number;
  reason?: string;
};
function evaluate(value: unknown): Decision {
  const fn = (
    domain as unknown as Record<string, (value: unknown) => Decision>
  )["evaluatePaymentRollout"];
  expect(fn).toBeTypeOf("function");
  return fn!(value);
}
test.each([
  [
    input.checkoutSessionId,
    input.providerAccountId,
    input.routeRuleId,
    506,
    7857,
  ],
  [
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
    "00000000-0000-4000-8000-000000000000",
    "12345678-1234-4234-8234-123456789abc",
    7268,
    7592,
  ],
  [
    "11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111",
    9865,
    8778,
  ],
] as const)(
  "matches frozen cross-runtime vectors for %s",
  (
    checkoutSessionId,
    providerAccountId,
    routeRuleId,
    providerBucket,
    ruleBucket,
  ) => {
    expect(
      evaluate({ ...input, checkoutSessionId, providerAccountId, routeRuleId }),
    ).toEqual({
      schemaVersion: 1,
      algorithmVersion: 1,
      kind: "ELIGIBLE",
      providerBucket,
      ruleBucket,
    });
  },
);
test("zero closes either gate and 10000 preserves the original all-open route", () => {
  expect(evaluate(input).kind).toBe("ELIGIBLE");
  for (const patch of [
    { providerRolloutBasisPoints: 0 },
    { ruleRolloutBasisPoints: 0 },
    { providerRolloutBasisPoints: 0, ruleRolloutBasisPoints: 0 },
  ])
    expect(evaluate({ ...input, ...patch }).kind).toBe("EXCLUDED");
});
test("both independent buckets must be strictly below the threshold", () => {
  for (const [providerRolloutBasisPoints, ruleRolloutBasisPoints, kind] of [
    [506, 7858, "EXCLUDED"],
    [507, 7857, "EXCLUDED"],
    [507, 7858, "ELIGIBLE"],
    [500, 10000, "EXCLUDED"],
    [2500, 10000, "ELIGIBLE"],
  ] as const)
    expect(
      evaluate({ ...input, providerRolloutBasisPoints, ruleRolloutBasisPoints })
        .kind,
    ).toBe(kind);
});
test("case normalization, repeated reads and proportion changes never resample", () => {
  const normal = evaluate(input);
  expect(
    evaluate({
      ...input,
      checkoutSessionId: input.checkoutSessionId.toUpperCase(),
      providerAccountId: input.providerAccountId.toUpperCase(),
      routeRuleId: input.routeRuleId.toUpperCase(),
    }),
  ).toEqual(normal);
  for (let index = 0; index < 20; index++)
    expect(evaluate(input)).toEqual(normal);
  const closed = evaluate({ ...input, ruleRolloutBasisPoints: 0 });
  expect({ ...closed, kind: "ELIGIBLE" }).toEqual(normal);
});
test("new immutable rule or provider identities change only their own cohort", () => {
  const original = evaluate(input);
  const nextRule = evaluate({
    ...input,
    routeRuleId: "a1000000-0000-4000-8000-000000000004",
  });
  expect(nextRule.providerBucket).toBe(original.providerBucket);
  expect(nextRule.ruleBucket).not.toBe(original.ruleBucket);
  const nextProvider = evaluate({
    ...input,
    providerAccountId: "a1000000-0000-4000-8000-000000000004",
  });
  expect(nextProvider.ruleBucket).toBe(original.ruleBucket);
  expect(nextProvider.providerBucket).not.toBe(original.providerBucket);
});
test("thousands of deterministic checkouts exercise separated five-percent cohorts", () => {
  let providers = 0,
    rules = 0,
    both = 0;
  for (let index = 0; index < 20000; index++) {
    const result = evaluate({
      ...input,
      checkoutSessionId: `d1000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      providerRolloutBasisPoints: 500,
      ruleRolloutBasisPoints: 500,
    });
    const p = result.providerBucket! < 500,
      r = result.ruleBucket! < 500;
    providers += Number(p);
    rules += Number(r);
    both += Number(p && r);
    expect(result.kind).toBe(p && r ? "ELIGIBLE" : "EXCLUDED");
  }
  expect(providers).toBeGreaterThan(850);
  expect(providers).toBeLessThan(1150);
  expect(rules).toBeGreaterThan(850);
  expect(rules).toBeLessThan(1150);
  expect(both).toBeGreaterThan(20);
  expect(both).toBeLessThan(85);
});
test("invalid, unknown and browser-chosen seed inputs fail closed", () => {
  for (const value of [
    null,
    { ...input, routeRuleId: "route" },
    { ...input, providerRolloutBasisPoints: 10001 },
    { ...input, seed: "browser" },
    { ...input, locale: "th" },
  ])
    expect(evaluate(value)).toEqual({
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_ROLLOUT_INPUT",
    });
});
